import asyncio
import json
import jsbeautifier
import gc
import re
from urllib.parse import urlparse
from typing import Dict, List, Optional, Any
from modules.utils import get_cached_script_source, set_cached_script_source, measure_time, performance_monitor
from modules.memory_manager import memory_manager, process_in_chunks


async def set_xhr_breakpoint(client, xhr_url="*"):
    """设置XHR请求断点

    Args:
        client: CDP客户端会话
        xhr_url: 要监听的XHR请求URL，默认为"*"表示监听所有XHR请求

    注意:
        - 当XHR请求匹配指定URL时，浏览器会暂停JavaScript执行
        - 空字符串或"*"表示监听所有XHR请求
        - URL可以是部分匹配，不需要完全一致
    """
    try:
        await client.send("DOMDebugger.setXHRBreakpoint", {"url": xhr_url})
        print(f"✓ XHR断点已设置: {xhr_url or '*'}")
    except Exception as e:
        print(f"❌ XHR断点设置失败: {e}")
        raise

    # 尝试设置额外的XHR事件断点(可选,失败不影响主要功能)
    try:
        await client.send("DOMDebugger.setInstrumentationBreakpoint", {"eventName": "xhrReadyStateChange"})
        await client.send("DOMDebugger.setInstrumentationBreakpoint", {"eventName": "xhrLoad"})
    except Exception as e:
        print(f"⚠️  XHR instrumentation断点设置失败(可忽略): {e}")

    try:
        await client.send("DOMDebugger.setEventListenerBreakpoint", {"eventName": "readystatechange", "targetName": "XMLHttpRequest"})
        await client.send("DOMDebugger.setEventListenerBreakpoint", {"eventName": "load", "targetName": "XMLHttpRequest"})
    except Exception as e:
        print(f"⚠️  XHR event listener断点设置失败(可忽略): {e}")

async def set_xhr_new_breakpoint(client, xhr_url, js_ready_event=None):
    """等待XHR断点触发并设置新的JS断点
    
    此函数实现了一个高级功能：当XHR断点触发时，自动在触发位置设置一个新的JS断点，
    然后移除原始XHR断点，并通知调试器可以开始监听新设置的JS断点。
    
    Args:
        client: CDP客户端会话
        xhr_url: 要监听的XHR请求URL
        js_ready_event: 可选的事件对象，用于通知调试器JS断点已准备就绪
        
    Returns:
        无返回值，但会设置js_ready_event事件（如果提供）
        
    Raises:
        Exception: 在断点处理过程中发生错误时抛出异常
    """
    print("等待XHR断点触发...")

    event_future = asyncio.get_event_loop().create_future()

    def paused_handler(event):
        if not event_future.done():
            event_future.set_result(event)

    try:
        client.once('Debugger.paused', paused_handler)
        
        try:
            event = await event_future
            print("XHR断点已触发！")
        except Exception as e:
            print(f"等待XHR断点触发时出错: {e}")
            raise

        call_stack = event['callFrames']
        top_call = call_stack[0]

        location = top_call['location']
        script_id = location['scriptId']  # 脚本ID
        line_number = location['lineNumber']  # 行号（0-based）
        column_number = location['columnNumber']  # 列号（0-based）

        try:
            await client.send("Debugger.setBreakpoint", {
                "location": {
                    "scriptId": script_id,
                    "lineNumber": line_number,
                    "columnNumber": column_number
                }
            })
        except Exception as e:
            print(f"设置JS断点时出错: {e}")
            raise

        try:
            await client.send("DOMDebugger.removeXHRBreakpoint", {"url": xhr_url})
            print("✅ 已移除XHR断点")
        except Exception as e:
            print(f"移除XHR断点时出错: {e}")

        print("✅ 已完成XHR断点处理并设置新JS断点，等待调试器接管并恢复执行")

        if js_ready_event:
            js_ready_event.set()
            
    except Exception as e:
        print(f"XHR断点处理过程中发生错误: {e}")
        raise
    finally:
        try:
            client.remove_listener('Debugger.paused', paused_handler)
        except Exception:
            pass  # 忽略移除失败（可能已自动移除）


def _normalize_url_for_match(value: Optional[str]) -> str:
    if not value:
        return ''
    value = value.strip()
    if not value:
        return ''
    parsed = urlparse(value)
    if parsed.scheme:
        netloc = parsed.netloc or ''
        path = parsed.path or ''
        return f"{netloc}{path}"
    return value


def _url_matches(script_url: str, target_url: str) -> bool:
    if not script_url or not target_url:
        return False
    normalized_script = _normalize_url_for_match(script_url)
    normalized_target = _normalize_url_for_match(target_url)
    if not normalized_script or not normalized_target:
        return False
    if normalized_script == normalized_target:
        return True
    if normalized_script.endswith(normalized_target):
        return True
    if normalized_target.startswith('/') and normalized_script.endswith(normalized_target):
        return True
    return False


def _get_cached_script_ids(client, target_url: str) -> List[str]:
    registry = getattr(client, '_script_registry', {})
    matches: List[str] = []
    if not registry or not target_url:
        return matches
    for url, script_ids in registry.items():
        if _url_matches(str(url), target_url):
            matches.extend(script_ids)
    return matches


def _remove_event_listener(client, event_name: str, handler):
    for attr in ('remove_listener', 'removeListener', 'off'):
        remover = getattr(client, attr, None)
        if callable(remover):
            try:
                remover(event_name, handler)
                return
            except Exception:
                continue


async def _await_script_id(client, target_url: str, timeout: float = 15.0, retry_count: int = 2) -> Optional[str]:
    """等待目标脚本被解析并返回其scriptId

    优化:
    - 增加默认超时时间到15秒(从5秒)
    - 添加重试机制
    - 改进日志记录

    Args:
        client: CDP客户端
        target_url: 目标脚本URL
        timeout: 单次等待超时时间(秒)
        retry_count: 重试次数

    Returns:
        脚本ID或None
    """
    existing = _get_cached_script_ids(client, target_url)
    if existing:
        print(f"✓ 在缓存中找到脚本ID: {existing[0]}")
        return existing[0]

    for attempt in range(retry_count):
        if attempt > 0:
            print(f"重试等待脚本 ({attempt + 1}/{retry_count})...")

        loop = asyncio.get_event_loop()
        future = loop.create_future()

        def handler(event):
            try:
                script_url = event.get('url') or ''
                script_id = event.get('scriptId')
                if script_id and _url_matches(script_url, target_url) and not future.done():
                    print(f"✓ 检测到目标脚本: {script_url} (ID: {script_id})")
                    future.set_result(script_id)
            except Exception as e:
                print(f"处理scriptParsed事件时出错: {e}")

        client.on('Debugger.scriptParsed', handler)
        try:
            result = await asyncio.wait_for(future, timeout)
            return result
        except asyncio.TimeoutError:
            if attempt == retry_count - 1:
                print(f"⚠️ 等待脚本超时: {target_url} (尝试了{retry_count}次)")
                return None
            await asyncio.sleep(1)  # 重试前等待1秒
        finally:
            _remove_event_listener(client, 'Debugger.scriptParsed', handler)

    return None


async def _set_breakpoint_with_script_id(client, script_id: str, line_number: int, column_number: int, condition: str = ""):
    location = {
        "scriptId": script_id,
        "lineNumber": line_number,
        "columnNumber": column_number
    }
    if condition:
        location["condition"] = condition
    return await client.send("Debugger.setBreakpoint", {"location": location})


async def set_breakpoint_on_load(client, url_or_regex, line_number=0, column_number=0, condition="", is_regex=False, timeout=20.0):
    """优化版:在脚本加载时立即设置断点(使用scriptParsed监听器)

    此函数会先注册scriptParsed监听器,然后在脚本加载时立即设置断点,
    确保不会错过早期执行的代码。特别适合处理混淆代码和快速执行的脚本。

    Args:
        client: CDP客户端会话
        url_or_regex: JavaScript文件的URL或URL正则表达式
        line_number: 断点行号（0-based）
        column_number: 断点列号（0-based）
        condition: 可选的断点条件表达式
        is_regex: 是否将url_or_regex作为正则表达式处理
        timeout: 等待脚本加载的超时时间(秒)

    Returns:
        dict: 包含断点ID和实际位置的结果对象
    """
    print(f"📍 正在注册断点监听器: {url_or_regex}:{line_number+1}:{column_number+1}")

    # 首先尝试在已加载的脚本上设置断点
    existing_ids = _get_cached_script_ids(client, url_or_regex)
    if existing_ids:
        print(f"✓ 脚本已加载,立即设置断点 (scriptId: {existing_ids[0]})")
        try:
            result = await _set_breakpoint_with_script_id(client, existing_ids[0], line_number, column_number, condition)
            print(f"✓ 断点设置成功: {url_or_regex}:{line_number+1}:{column_number+1}")
            return result
        except Exception as e:
            print(f"⚠️ 在已加载脚本上设置断点失败: {e}")

    # 注册监听器,等待脚本加载
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    breakpoint_set = False

    def handler(event):
        nonlocal breakpoint_set
        try:
            script_url = event.get('url') or ''
            script_id = event.get('scriptId')

            if not script_id:
                return

            # 检查URL是否匹配
            is_match = False
            if is_regex:
                import re
                try:
                    if re.search(url_or_regex, script_url):
                        is_match = True
                except Exception:
                    pass
            else:
                is_match = _url_matches(script_url, url_or_regex)

            if is_match and not breakpoint_set and not future.done():
                breakpoint_set = True
                print(f"✓ 检测到目标脚本,立即设置断点: {script_url} (ID: {script_id})")

                # 在协程中设置断点
                async def set_bp():
                    try:
                        result = await _set_breakpoint_with_script_id(client, script_id, line_number, column_number, condition)
                        future.set_result(result)
                        print(f"✓ 断点设置成功: {url_or_regex}:{line_number+1}:{column_number+1}")
                    except Exception as e:
                        if not future.done():
                            future.set_exception(e)

                asyncio.create_task(set_bp())
        except Exception as e:
            print(f"处理scriptParsed事件时出错: {e}")
            if not future.done():
                future.set_exception(e)

    client.on('Debugger.scriptParsed', handler)
    try:
        result = await asyncio.wait_for(future, timeout)
        return result
    except asyncio.TimeoutError:
        print(f"⚠️ 等待脚本加载超时: {url_or_regex}")
        raise RuntimeError(f"等待脚本加载超时: {url_or_regex}")
    finally:
        _remove_event_listener(client, 'Debugger.scriptParsed', handler)


async def set_breakpoint(client, url_or_regex, line_number=0, column_number=0, condition="", is_regex=False):
    """在指定URL或匹配正则表达式的JavaScript文件中设置断点

    使用CDP的Debugger.setBreakpointByUrl命令,这是设置断点的标准方法。

    关键特性:
    1. 断点会"注册"到CDP,在匹配的脚本加载时自动生效
    2. 即使脚本当前未加载,断点也会在未来脚本加载时自动设置
    3. 支持URL模式匹配,可以匹配动态加载的脚本
    4. 多次加载同一脚本时,断点会在每次加载时都生效

    正确的使用流程:
    1. 连接到CDP
    2. 调用此函数设置断点(此时脚本可能还未加载)
    3. 导航页面或reload
    4. 当匹配的脚本加载时,断点自动生效

    不需要:
    - 等待脚本加载
    - 监听scriptParsed事件
    - 使用scriptId设置断点(除非URL匹配失败)

    Args:
        client: CDP客户端会话
        url_or_regex: JavaScript文件的URL或URL正则表达式
        line_number: 断点行号（0-based，显示时会+1）
        column_number: 断点列号（0-based，显示时会+1）
        condition: 可选的断点条件表达式，只有表达式为true时断点才会触发
        is_regex: 是否将url_or_regex作为正则表达式处理

    Returns:
        dict: 包含断点ID和实际位置的结果对象

    Raises:
        Exception: 设置断点失败时抛出异常
    """
    payload = {
        "lineNumber": line_number,
        "columnNumber": column_number,
    }
    if condition:
        payload["condition"] = condition

    command = {"urlRegex": url_or_regex} if is_regex else {"url": url_or_regex}
    payload.update(command)

    try:
        result = await client.send("Debugger.setBreakpointByUrl", payload)
        locations = result.get("locations", [])

        if locations:
            # 断点已在当前加载的脚本上设置
            print(f"✓ 断点已设置 (脚本已加载): {url_or_regex}:{line_number+1}:{column_number+1}")
        else:
            # 断点已配置,将在脚本加载时生效
            print(f"✓ 断点已配置 (将在脚本加载时生效): {url_or_regex}:{line_number+1}:{column_number+1}")

        return result
    except Exception as err:
        error_msg = f"设置断点失败: {url_or_regex}:{line_number+1}:{column_number+1} - {err}"
        print(f"❌ {error_msg}")
        raise RuntimeError(error_msg) from err

def should_skip_property(name: str, value_obj: dict) -> bool:
    """判断属性是否应被跳过（跳过不必要的数据）"""
    if value_obj is None:
        return True
    if not name:
        return True
    if name == "this" or name.startswith('$'):
        return True
    description = value_obj.get("description", "")
    if description in ("Window", "global", "VueComponent", "HTMLDivElement", "HTMLElement", "options"):
        return True
    if description == "Object" and value_obj.get("className") == "Object" and value_obj.get("subtype") == "object":
        preview = value_obj.get("preview", {})
        properties = preview.get("properties", [])
        if len(properties) <= 5:
            return False
        return True
    if value_obj.get("type") == "function":
        return True
    if "Vue" in description or "Window" in description:
        return True
    if ("value" in value_obj and value_obj["value"] is None) or \
       ("description" in value_obj and value_obj["description"] == "null") or \
       name in {"constructor", "prototype", "$super", "__proto__", "window", "document", "location"}:
        return True
    return False


async def extract_array_values(value_obj: dict, client, max_items: int = 5):
    """提取数组前若干个元素，优先使用 Runtime.getProperties，退回 preview。"""
    if not value_obj:
        return [], 0

    object_id = value_obj.get("objectId")
    desc = value_obj.get("description", "")
    length_hint = None
    match = re.search(r"Array\((\d+)\)", desc)
    if match:
        try:
            length_hint = int(match.group(1))
        except Exception:
            length_hint = None

    values = []
    extra = 0

    if object_id:
        try:
            props_resp = await client.send("Runtime.getProperties", {
                "objectId": object_id,
                "ownProperties": True,
                "accessorProperties": False,
                "nonIndexedPropertiesOnly": False
            })
            entries = []
            seen = set()
            result_props = props_resp.get("result", [])

            if not result_props:
                pass  # 数组为空或无法获取属性

            for prop in result_props:
                name = prop.get("name")
                if name == "length":
                    try:
                        length_hint = int(prop.get("value", {}).get("value", length_hint or 0))
                    except Exception:
                        pass
                    continue
                if not name or not name.isdigit():
                    continue
                idx = int(name)
                seen.add(idx)
                val_obj = prop.get("value", {})
                if val_obj.get("type") in ("number", "string", "boolean") and "value" in val_obj:
                    display = val_obj["value"]
                elif "value" in val_obj:
                    display = val_obj["value"]
                else:
                    display = val_obj.get("description", "[对象]")
                entries.append((idx, display))

            entries.sort(key=lambda item: item[0])
            for _, display in entries[:max_items]:
                values.append(display)
            if len(entries) > max_items:
                extra = len(entries) - max_items
            if length_hint is None and entries:
                length_hint = entries[-1][0] + 1

            if values:
                pass  # 提取成功
        except Exception as e:
            pass  # 提取失败

    if not values:
        preview = value_obj.get("preview", {})
        props = preview.get("properties", [])
        for item in props[:max_items]:
            val = item.get("value")
            if isinstance(val, dict):
                if "value" in val:
                    values.append(val["value"])
                elif "description" in val:
                    values.append(val["description"])
                else:
                    values.append("[对象]")
            elif val is not None:
                values.append(val)
            else:
                values.append(item.get("description", "[对象]"))
        if len(props) > max_items:
            extra = max(extra, len(props) - max_items)

    if length_hint is not None and length_hint > len(values):
        extra = max(extra, length_hint - len(values))

    return values, max(0, extra)

def detect_jsvmp_patterns(source: str) -> dict:
    """检测JavaScript虚拟机保护(JSVMP)和代码混淆模式

    JSVMP特征:
    - 大量switch-case语句
    - 密集的数组访问模式
    - 频繁使用eval/Function
    - 短变量名和混淆标识符
    - 字符串拼接和编码

    Returns:
        dict: 包含检测结果和建议的字典
    """
    if not source or len(source) < 100:
        return {"is_obfuscated": False, "confidence": 0.0, "patterns": [], "suggestions": []}

    patterns_found = []
    score = 0.0

    # 检测大量switch-case (JSVMP核心特征)
    switch_count = source.count('switch')
    case_count = source.count('case ')
    if switch_count > 5 and case_count > 50:
        patterns_found.append(f"大量switch-case结构 ({switch_count}个switch, {case_count}个case)")
        score += 0.3

    # 检测数组访问模式 (指令调度)
    array_access_pattern = re.findall(r'\[\d+\]|\[0x[0-9a-fA-F]+\]|\[[_$a-zA-Z][_$\w]*\[', source)
    if len(array_access_pattern) > 100:
        patterns_found.append(f"密集数组访问 ({len(array_access_pattern)}处)")
        score += 0.25

    # 检测eval/Function使用
    eval_count = source.count('eval(') + source.count('Function(')
    if eval_count > 3:
        patterns_found.append(f"动态代码执行 ({eval_count}处eval/Function)")
        score += 0.15

    # 检测短变量名比例 (高度混淆)
    short_var_pattern = re.findall(r'\b[_$][a-zA-Z0-9]{0,2}\b', source)
    if len(short_var_pattern) > 50:
        ratio = len(short_var_pattern) / max(len(source.split()), 1)
        if ratio > 0.1:
            patterns_found.append(f"高比例短变量名 ({len(short_var_pattern)}个)")
            score += 0.15

    # 检测字符串编码/混淆
    encoded_strings = re.findall(r'\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}', source)
    if len(encoded_strings) > 20:
        patterns_found.append(f"编码字符串 ({len(encoded_strings)}处)")
        score += 0.10

    # 检测超长单行或极短行(扁平化混淆)
    lines = source.split('\n')
    long_lines = sum(1 for line in lines if len(line) > 500)
    if long_lines > 5:
        patterns_found.append(f"代码扁平化 ({long_lines}行超长代码)")
        score += 0.05

    confidence = min(score, 1.0)
    is_obfuscated = confidence > 0.3

    suggestions = []
    if is_obfuscated:
        suggestions.append("检测到代码混淆/JSVMP,建议:")
        if 'switch-case' in str(patterns_found):
            suggestions.append("- 在switch语句开始处设置断点")
            suggestions.append("- 关注数组变量的初始值")
        if 'eval' in str(patterns_found) or 'Function' in str(patterns_found):
            suggestions.append("- 在eval/Function调用前设置断点,查看传入参数")
        suggestions.append("- 使用step_over而非step_into减少进入混淆代码")
        suggestions.append("- 重点关注XHR/Fetch请求和响应处理")

    return {
        "is_obfuscated": is_obfuscated,
        "confidence": confidence,
        "patterns": patterns_found,
        "suggestions": suggestions
    }


async def get_script_source(client, script_id: str) -> str:
    """
    统一获取脚本源代码，首先检查缓存，若无则通过 CDP 命令获取并缓存。
    """
    cached_source = get_cached_script_source(script_id)
    if cached_source is not None:
        return cached_source
    try:
        response = await client.send("Debugger.getScriptSource", {"scriptId": script_id})
        source = response.get("scriptSource", "")
        set_cached_script_source(script_id, source)
        return source
    except Exception as e:
        print(f"获取脚本源代码出错（{script_id}）：{e}")
        return ""


async def get_code_context(client, script_id, line_number, column_number):
    """
    获取断点处前后各100个字符的上下文片段，并在位置插入“➤”。
    返回 context_text（字符串）；为兼容旧逻辑，也返回按换行分割的 context_lines。
    """
    try:
        try:
            from backend.config import config as _cfg
            ctx_chars = int(_cfg.get('debug.context_chars', 150))
        except Exception:
            ctx_chars = 150

        raw_source = await get_script_source(client, script_id)
        if not raw_source:
            return {"context_text": "获取源代码失败", "context_lines": ["获取源代码失败"]}

        lines = raw_source.splitlines()
        if line_number >= len(lines):
            offset = int(column_number or 0)
        else:
            offset = sum(len(lines[i]) + 1 for i in range(int(line_number))) + int(column_number or 0)

        start = max(0, offset - ctx_chars)
        end = min(len(raw_source), offset + ctx_chars)
        snippet = raw_source[start:end]

        rel = offset - start
        if rel < 0: rel = 0
        if rel > len(snippet): rel = len(snippet)
        snippet_with_marker = snippet[:rel] + '➤' + snippet[rel:]

        return {
            "context_text": snippet_with_marker,
            "context_lines": snippet_with_marker.splitlines() or [snippet_with_marker]
        }
    except Exception as e:
        return {"context_text": f"获取源代码失败: {str(e)}", "context_lines": [f"获取源代码失败: {str(e)}"]}




async def get_script_url_by_id(client, script_id):
    """
    通过脚本源代码尝试获取 URL（此处直接返回脚本ID，扩展逻辑时可根据需要解析 URL）
    """
    source = await get_script_source(client, script_id)
    if not source:
        return f"脚本ID: {script_id}"
    return f"脚本ID: {script_id}"


async def get_call_stack(callFrames):
    """
    获取格式化的调用堆栈信息
    """
    call_stack = []
    for i, frame in enumerate(callFrames):
        function_name = frame.get("functionName") or "<匿名函数>"
        url = frame.get("url", "")
        line_number = frame["location"]["lineNumber"] + 1
        column_number = frame["location"].get("columnNumber", 0) + 1
        if url:
            script_location = f"{url}:{line_number}:{column_number}"
        else:
            script_id = frame["location"]["scriptId"]
            script_location = f"脚本ID:{script_id}, 行:{line_number}, 列:{column_number}"
        call_stack.append(f"{i+1}. {function_name} ({script_location})")
    return call_stack


async def get_object_properties(object_id, client, max_depth=2, current_depth=0, max_props=15, max_total_props=15):
    """
    获取对象属性信息，支持递归查询（限制递归深度和总属性数）
    
    优化点：
    - 减少递归深度和属性数量限制，降低内存占用
    - 对大型对象进行更严格的过滤
    - 添加内存使用监控和主动垃圾回收
    """
    if current_depth == 0:
        get_object_properties.total_props_count = 0
        
    if current_depth > max_depth or getattr(get_object_properties, 'total_props_count', 0) > max_total_props:
        return "[对象过大或嵌套过深]"
        
    try:
        props_resp = await client.send("Runtime.getProperties", {
            "objectId": object_id,
            "ownProperties": True,
            "accessorProperties": True,
            "generatePreview": True
        })
        
        all_props = props_resp.get("result", [])
        result_size = len(all_props)
        
        if result_size > 50 and current_depth > 0:
            return f"[大型对象: 包含约 {result_size} 个属性]"
            
        result = {}
        
        descriptions = [prop.get("value", {}).get("description", "") for prop in all_props if prop.get("value")]
        is_framework_component = any(("Vue" in desc or "_react" in desc or "React" in desc) for desc in descriptions)
        
        if is_framework_component and current_depth > 0:
            key_props = [p for p in all_props if p.get("name") in ["_data", "state", "props", "type", "id", "key"]]
            if key_props:
                for prop in key_props[:3]:  # 减少为最多3个关键属性
                    name = prop.get("name")
                    value_obj = prop.get("value")
                    if value_obj and "value" in value_obj:
                        result[name] = value_obj["value"]
                    else:
                        result[name] = value_obj.get("description", "[对象]") if value_obj else "[未知值]"
                return f"[框架组件: {', '.join(result.keys())}]"
            return "[框架组件]"
            
        important_props = []
        normal_props = []
        important_names = ["id", "name", "key", "type", "value", "data", "url", "method", 
                         "token", "params", "response", "result", "error", "code", "status"]
        
        for prop in all_props:
            name = prop.get("name")
            if name in important_names:
                important_props.append(prop)
            else:
                normal_props.append(prop)
                
        selected_props = important_props + normal_props
        if len(selected_props) > max_props:
            selected_props = important_props + normal_props[:max_props - len(important_props)]
            result["_note"] = f"[属性过多，显示 {len(selected_props)}/{len(all_props)}]"
            
        for prop in selected_props:
            name = prop.get("name")
            value_obj = prop.get("value")
            
            if value_obj is None or should_skip_property(name, value_obj):
                continue
                
            get_object_properties.total_props_count += 1
            if get_object_properties.total_props_count > max_total_props:
                result["_truncated"] = "[达到最大属性限制]"
                break
                
            val_type = value_obj.get("type")

            if val_type in ("number", "string", "boolean", "undefined"):
                result[name] = value_obj.get("value")
            elif "objectId" in value_obj and current_depth < max_depth:
                obj_type = value_obj.get("type")
                obj_subtype = value_obj.get("subtype")
                obj_class = value_obj.get("className", "")
                obj_desc = value_obj.get("description", "")

                is_array_like = (
                    obj_subtype == "array" or
                    (obj_desc and obj_desc.startswith("Array(")) or
                    (obj_class and "Array" in obj_class)
                )

                if obj_type == "object" and is_array_like:
                    array_values, extra = await extract_array_values(
                        value_obj,
                        client,
                        max_items=max(1, min(max_props, max_total_props))
                    )
                    if array_values:
                        if extra > 0:
                            array_values.append(f"... 还有 {extra} 个元素 ...")
                        result[name] = array_values
                    else:
                        result[name] = obj_desc or "[数组]"
                elif name in ["params", "data", "key", "iv"] or (
                     current_depth == 0 and obj_type == "object" and not obj_subtype):
                    nested_props = await get_object_properties(
                        value_obj["objectId"],
                        client,
                        max_depth,
                        current_depth + 1,
                        max_props,
                        max_total_props
                    )
                    result[name] = nested_props
                elif "HTML" in obj_class or "Element" in obj_class:
                    result[name] = f"[{obj_desc}]"
                else:
                    result[name] = obj_desc or value_obj.get("value")
            else:
                if "value" in value_obj:
                    result[name] = value_obj.get("value")
                else:
                    result[name] = value_obj.get("description", "[未知值]")
                
        if current_depth == 0 and result_size > 50:
            gc.collect()
            
        return result
    except Exception as e:
        return {"错误": str(e)}


async def process_debugger_paused(event, client, session_config=None):
    """
    处理调试器暂停事件，收集断点信息、代码上下文、调用堆栈以及作用域变量

    Args:
        event: CDP调试暂停事件
        client: CDP客户端
        session_config: 会话配置对象（可选），包含 scope_max_depth 和 scope_max_total_props

    优化点：
    - 减少收集的调试信息量，降低内存占用
    - 实现增量数据收集，避免一次性加载大量数据
    - 添加内存使用监控和主动垃圾回收
    - 对大型调用堆栈和作用域进行更严格的过滤
    - 添加性能监控
    """
    performance_monitor.start('process_debugger_paused')

    memory_info = memory_manager.get_memory_info()
    high_memory_usage = memory_info['percent'] > 70

    divider = "=" * 60
    debug_info = f"\n{divider}\n🔍 调试器已暂停\n{divider}\n"
    callFrames = event.get("callFrames", [])

    if not callFrames:
        debug_info += "⚠️ 无法获取调用帧信息\n"
        print(debug_info)
        return debug_info

    top_frame = callFrames[0]

    script_url = top_frame.get("url", "")
    function_name = top_frame.get("functionName", "")

    if (
        (script_url and (script_url.startswith("VM") or script_url.startswith("debugger://"))) or
        (not script_url or script_url == "") and (
            "temp_apply" in function_name or
            "temp_call" in function_name or
            "temp_encrypt" in function_name or
            "temp_decrypt" in function_name or
            "temp_finalize" in function_name or
            "paused_handler" in function_name or
            "console_handler" in function_name or
            function_name == "" or
            "onEachInteraction" in function_name or
            "Promise" in function_name
        )
    ):
        print(f"⏭️  跳过内部脚本断点: {script_url or '(no URL)'} / {function_name or '(anonymous)'}")
        return None
    script_id = top_frame["location"]["scriptId"]
    line_number = top_frame["location"]["lineNumber"]
    col_number = top_frame["location"].get("columnNumber", 0)
    function_name = top_frame.get("functionName") or "<匿名函数>"

    max_call_frames = 3 if high_memory_usage else 5
    max_scope_frames = 1 if high_memory_usage else 2

    script_url = await get_script_url_by_id(client, script_id)
    debug_info += f"📍 暂停位置: {function_name} 在 {script_url}\n"
    debug_info += f"📍 具体位置: 行 {line_number+1}, 列 {col_number+1}\n\n"

    # JSVMP/混淆检测
    try:
        source = await get_script_source(client, script_id)
        if source:
            obfuscation_info = detect_jsvmp_patterns(source)
            if obfuscation_info["is_obfuscated"]:
                debug_info += "⚠️  代码混淆检测:\n"
                debug_info += f"   混淆置信度: {obfuscation_info['confidence']:.0%}\n"
                if obfuscation_info['patterns']:
                    debug_info += "   检测到的模式:\n"
                    for pattern in obfuscation_info['patterns']:
                        debug_info += f"     • {pattern}\n"
                if obfuscation_info['suggestions']:
                    debug_info += "   调试建议:\n"
                    for suggestion in obfuscation_info['suggestions'][1:]:  # 跳过第一个总标题
                        debug_info += f"     {suggestion}\n"
                debug_info += "\n"
    except Exception as e:
        print(f"JSVMP检测失败: {e}")
    
    code_context = await get_code_context(client, script_id, line_number, col_number)
    debug_info += "📝 代码上下文:\n"
    for line in code_context.get("context_lines", []):
        debug_info += f"{line}\n"
    debug_info += "\n"
    
    call_stack = await get_call_stack(callFrames[:max_call_frames])
    if call_stack:
        debug_info += "🔄 调用堆栈:\n"
        for frame_info in call_stack:
            debug_info += f"  {frame_info}\n"
        debug_info += "\n"
    
    gc.collect()
    
    debug_info += "🔍 作用域变量:\n"
    found_interesting_scope = False
    
    for i, frame in enumerate(callFrames[:max_scope_frames]):
        if high_memory_usage and i > 0:
            break  # 高内存使用时只处理顶层帧
            
        frame_name = frame.get("functionName") or f"<匿名函数 {i}>"
        relevant_scopes = []
        
        for scope in frame.get("scopeChain", []):
            scope_type = scope.get("type")
            if scope_type not in ("local", "block") or scope_type == "this":
                continue
                
            obj_desc = scope.get("object", {}).get("description", "")
            if obj_desc in ("Window", "options"):
                continue
                
            object_id = scope.get("object", {}).get("objectId")
            if not object_id:
                continue
                
            relevant_scopes.append({
                "object_id": object_id,
                "scope_type": scope_type,
                "frame_name": frame_name
            })
        
        max_scopes = 1 if high_memory_usage else 2
        for scope_info in relevant_scopes[:max_scopes]:
            if session_config:
                base_depth = getattr(session_config, 'scope_max_depth', 5)
                base_total = getattr(session_config, 'scope_max_total_props', 15)
            else:
                try:
                    from backend.config import config as _cfg
                    base_depth = int(_cfg.get('debug.scope_max_depth', 5))
                    base_total = int(_cfg.get('debug.scope_max_total_props', 15))
                except Exception:
                    base_depth, base_total = 5, 15

            effective_depth = max(2, base_depth - 1) if high_memory_usage else base_depth

            scope_properties = await get_object_properties(
                scope_info["object_id"],
                client,
                max_depth=effective_depth,
                max_props=base_total,
                max_total_props=base_total
            )
            
            if not scope_properties:
                continue
                
            found_interesting_scope = True
            scope_type_cn = {"local": "局部", "block": "块级"}.get(scope_info["scope_type"], scope_info["scope_type"])
            debug_info += f"  📋 {scope_type_cn}作用域 ({scope_info['frame_name']}):\n"
            
            max_props_to_show = 10 if high_memory_usage else 20
            prop_count = 0
            
            for name, value in scope_properties.items():
                prop_count += 1
                if prop_count > max_props_to_show:
                    debug_info += f"    ... 还有 {len(scope_properties) - max_props_to_show} 个属性未显示 ...\n"
                    break
                debug_info += f"    {name}: {json.dumps(value, ensure_ascii=False)}\n"
            
            gc.collect()
    
    if not found_interesting_scope:
        debug_info += "  [作用域中未找到相关变量]\n"
    
    debug_info += f"\n{divider}\n"

    # 性能统计
    elapsed = performance_monitor.end('process_debugger_paused')
    if elapsed > 0.5:  # 如果处理时间超过0.5秒,记录警告
        print(f"⚠️  断点处理耗时: {elapsed:.2f}秒 (较慢)")
    else:
        print(f"✓ 断点处理耗时: {elapsed:.2f}秒")

    print(debug_info)

    gc.collect()
    return debug_info
