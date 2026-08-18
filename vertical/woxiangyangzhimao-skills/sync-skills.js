// sync-skills.js — 技能库一键同步脚本
// 用法: node sync-skills.js
// 把 D:\下载\GitHub\skills 同步到 Claude/Codex/Gemini 的技能目录

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = String.raw`D:\下载\GitHub\skills`;
const TARGETS = [
    { name: 'Claude', dir: path.join(process.env.USERPROFILE, '.claude', 'skills'), skip: ['learned', '.system'] },
    { name: 'Codex', dir: path.join(process.env.USERPROFILE, '.codex', 'skills'), skip: ['.system'] },
    { name: 'Gemini', dir: path.join(process.env.USERPROFILE, '.gemini', 'config', 'skills'), skip: [] },
];

// 获取源技能列表
const srcSkills = fs.readdirSync(SRC, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'docs' && d.name !== '.git')
    .map(d => d.name);

console.log(`\n📦 技能库: ${srcSkills.length} 个技能`);
console.log('='.repeat(50));

for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) {
        console.log(`\n⏭️  ${target.name}: 目录不存在，跳过`);
        continue;
    }
    
    let copied = 0, skipped = 0, updated = 0;
    
    for (const skill of srcSkills) {
        if (target.skip.includes(skill)) { skipped++; continue; }
        
        const src = path.join(SRC, skill);
        const dst = path.join(target.dir, skill);
        const srcMd = path.join(src, 'SKILL.md');
        const dstMd = path.join(dst, 'SKILL.md');
        
        if (!fs.existsSync(srcMd)) { skipped++; continue; }
        
        if (fs.existsSync(dstMd)) {
            // 比较修改时间决定是否更新
            const srcTime = fs.statSync(srcMd).mtimeMs;
            const dstTime = fs.statSync(dstMd).mtimeMs;
            if (srcTime <= dstTime) { skipped++; continue; }
            // 源更新，覆盖
            execSync(`xcopy "${src}" "${dst}" /E /Y /I /Q`, { stdio: 'ignore' });
            updated++;
        } else {
            // 新增
            execSync(`xcopy "${src}" "${dst}" /E /Y /I /Q`, { stdio: 'ignore' });
            copied++;
        }
    }
    
    console.log(`\n🔄 ${target.name} (${target.dir})`);
    console.log(`   新增: ${copied} | 更新: ${updated} | 跳过: ${skipped}`);
}

console.log('\n' + '='.repeat(50));
console.log('✅ 同步完成');
