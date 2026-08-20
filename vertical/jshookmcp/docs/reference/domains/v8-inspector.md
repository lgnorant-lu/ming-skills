# V8 检查器

域名：`v8-inspector`

V8 检查器域，提供堆快照分析、CPU 分析和内存检查。

## Profile

- workflow
- full

## 典型场景

- 堆快照分析
- CPU 性能分析
- 内存泄漏检测

## 常见组合

- v8-inspector + browser
- v8-inspector + debugger

## 工具清单（22）

| 工具 | 说明 |
| --- | --- |
| `v8_heap_snapshot_capture` | 从活跃浏览器目标捕获 V8 堆快照。 |
| `v8_heap_snapshot_analyze` | 分析先前捕获的 V8 堆快照。 |
| `v8_heap_diff` | 对比两个已捕获的 V8 堆快照。 |
| `v8_object_inspect` | 按地址检查 V8 堆对象。 |
| `v8_heap_stats` | 返回 V8 堆快照统计。 |
| `v8_bytecode_extract` | 从 V8 脚本派生伪字节码。 |
| `v8_version_detect` | 检测 V8 引擎版本和功能支持。 |
| `v8_jit_inspect` | 检查 V8 脚本的 JIT 优化状态。 |
| `v8_heap_find_leaks` | 在堆快照中查找疑似内存泄漏。返回按置信度排序的泄漏候选，包括分离的 DOM 节点、大数组、闭包泄漏和意外保留的大对象。 |
| `v8_heap_retainers` | 从疑似泄漏对象回溯到 GC 根的保留链。对每个 nodeId，沿直接支配者链生成"什么在保留它存活"的路径：叶子 → ... → GC 根。每步包含 nodeId、名称、类名、浅大小、保留大小和到叶子的距离。在 v8_heap_find_leaks 或 v8_heap_snapshot_analyze 之后使用，理解特定对象为何未被回收。 |
| `v8_deopt_trace` | 在采集窗口内追踪 V8 逆优化事件。通过 natives 语法启用 %TraceDeoptimizations，捕获逆优化事件（函数名、原因、bailout 位置）。需要 V8 natives 语法支持，不可用时优雅降级。 |
| `v8_turbofan_inspect` | 检查脚本中函数的 TurboFan 编译状态。报告优化层级（interpreted/maglev/turbofan）。支持操作：inspect（默认）、optimize（%OptimizeFunctionOnNextCall）、deoptimize（%DeoptimizeFunction）。需要 V8 natives 语法支持。 |
| `v8_turbofan_graph` | 采集并可视化 V8 TurboFan IR（节点海 / Turboshaft 图）。两种模式：(1) 传入 JS 源码——启动隔离 V8 子进程，以 --trace-turbo 生成 IR JSON，解析节点、边、阶段和操作码直方图；(2) 传入 traceDir 路径读取已生成的 turbo-*.json 文件。返回每个函数的图摘要，含阶段级节点/边数、样本节点和操作码分布。 |
| `v8_function_retained` | 查找被匹配名称模式的函数所保留的所有堆对象。遍历支配树找到构造函数/类名匹配给定模式的对象，返回每个对象及其保留链。用于理解特定函数/类持有哪些对象存活。 |
| `v8_object_compare` | 按浅大小/保留大小、类名和属性数比较堆对象。同快照模式（仅 objectIds）做全配对比较（n-choose-2）。跨快照模式（anotherSnapshotId + anotherObjectIds）做逐对 A[i]↔B[i] 比较。用于追踪对象增长、查找内存回归候选或对比泄漏与健康对象。 |
| `v8_wasm_inspect` | 检查页面中的 WebAssembly 模块和垃圾回收的 WASM 对象。发现 .wasm 脚本资源，检测 WASM GC（struct/array/ref-types）可用性，枚举特性标志（gc/threads/simd）。支持可选 scriptId 过滤器检查特定 WASM 模块。需要浏览器/页面 CDP 上下文。 |
| `v8_heap_sampling` | 通过 CDP HeapProfiler 收集 V8 分配采样 profile。在采集窗口内（默认 5 秒）启动采样，返回聚合的分配调用树：每个函数的 self/total 字节 + 采样数，按总分配字节排序。用于定位热点分配站点而无需完整堆快照。需要浏览器/页面 CDP 上下文。 |
| `v8_allocation_track` | 通过 CDP HeapProfiler 对象追踪跟踪 V8 实时分配。在采集窗口内（默认 3 秒）启动分配追踪，返回窗口期间仍存活的已分配对象（顶部帧 + 大小）。用于发现在特定交互期间经历 GC 仍存活的对象。需要浏览器/页面 CDP 上下文，完整栈解析需 V8 natives。 |
| `v8_weakrefs_inspect` | 通过 Runtime.evaluate 枚举页面中的 WeakRef 和 FinalizationRegistry 实例。检查已注册的终结回调和存活的 WeakRef 目标，报告多少 WeakRef 已 deref、多少已清除，以及哪些 FinalizationRegistry 有待处理条目。用于诊断长生命周期页面的清理逻辑。需要浏览器/页面 CDP 上下文。 |
| `v8_heap_snapshot_list` | 列出 V8 堆快照——含内存中（当前会话）与持久化到 artifacts/heap-snapshots/（重启后仍保留）的快照，返回 ID、捕获时间、大小、来源、模拟标记、过期状态及聚合统计。仅返回元数据，不含快照内容。 |
| `v8_heap_snapshot_delete` | 删除持久化的 V8 堆快照文件（.heapsnapshot 数据 + .meta.json 侧车），同时清除内存中对应缓存条目。设置 deleteAll=true 可删除全部持久化快照，不影响运行中的 V8 堆。 |
| `v8_heap_snapshot_export` | 将堆快照导出为完整的 .heapsnapshot JSON 文件，存入 artifacts/heap-snapshots/，可由 Chrome DevTools Memory 面板加载。返回文件路径，快照内容写入磁盘而非注入响应（文件可能很大）。 |
