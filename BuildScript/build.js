/*
  JS 构建脚本：一键生成便携目录并可选调用 NSIS 打包
  目录策略：
    - BuildScript/       构建脚本与模板（不清空）
    - Dist/Build/        构建中间产物（清空覆盖）
    - Dist/unpackaged/   便携目录输出（清空覆盖）
    - Dist/Packaged/     NSIS 安装器输出（清空覆盖）

  用法：
    node BuildScript/build.js [--nodeExePath=C:\\PortableNode\\node.exe]
    （未指定时默认使用当前运行本脚本的 node 可执行文件）
*/

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawnSync } = require('child_process');

function logInfo(msg) { console.log(`[INFO]  ${msg}`); }
function logWarn(msg) { console.warn(`[WARN]  ${msg}`); }
function logErr(msg) { console.error(`[ERROR] ${msg}`); }

async function rmrf(target) {
  try { await fsp.rm(target, { recursive: true, force: true }); } catch {}
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

function isSubdirNameExcluded(name) {
  return [
    '.git', '.vscode', 'Build', 'unpackaged', 'Packaged'
  ].includes(name);
}

async function copyRecursive(src, dst) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await ensureDir(dst);
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && isSubdirNameExcluded(ent.name)) continue;
      const s = path.join(src, ent.name);
      const d = path.join(dst, ent.name);
      if (ent.isDirectory()) {
        await copyRecursive(s, d);
      } else if (ent.isFile()) {
        await fsp.copyFile(s, d);
      }
    }
  } else if (st.isFile()) {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(src, dst);
  }
}

function getArg(name) {
  const pref = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith(pref)) return a.slice(pref.length);
    if (a === `--${name}`) return process.argv[i + 1];
  }
  return undefined;
}

function nowTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const scriptDir = __dirname;
  const root = path.resolve(scriptDir, '..');
  const DistDir = path.join(root, 'Dist');
  const BuildDir = path.join(DistDir, 'Build');
  const UnpackagedDir = path.join(DistDir, 'unpackaged');
  const PackagedDir = path.join(DistDir, 'Packaged');

  // 清空输出目录
  for (const dir of [BuildDir, UnpackagedDir, PackagedDir]) {
    await ensureDir(dir);
    const contents = await fsp.readdir(dir).catch(() => []);
    await Promise.all(contents.map((name) => rmrf(path.join(dir, name))));
    logInfo(`清空目录: ${dir}`);
  }

  // 解析 node.exe 路径
  let nodeExePath = getArg('nodeExePath') || process.env.NODE_EXE_PATH;
  if (!nodeExePath) {
    nodeExePath = process.execPath;
  }
  if (!(await pathExists(nodeExePath))) {
    logErr(`未找到 node 可执行文件: ${nodeExePath}`);
    process.exit(1);
  }
  logInfo(`使用 node.exe: ${nodeExePath}`);

  // 创建便携目录结构
  const PortableDir = path.join(UnpackagedDir, 'portable');
  const BinDir = path.join(PortableDir, 'bin');
  const AppDir = path.join(PortableDir, 'app');
  await ensureDir(BinDir);
  await ensureDir(AppDir);

  // 复制 node.exe
  await fsp.copyFile(nodeExePath, path.join(BinDir, 'node.exe'));

  // 复制资源（注意：排除 config/env.yaml，包含根目录下的 说明书/ 若存在）
  const copyList = [
    'main.js',
    'modules',
    'utils',
    'tools',
    'config',
    'prompts',
    '说明书',
    'sourcefiles',
    'package.json',
    'package-lock.json',
    'node_modules',
  ];
  for (const item of copyList) {
    const src = path.join(root, item);
    const dst = path.join(AppDir, item);
    if (await pathExists(src)) {
      logInfo(`复制: ${item}`);
      // 特殊处理 config：复制但排除 env.yaml
      if (item === 'config') {
        await ensureDir(dst);
        const entries = await fsp.readdir(src, { withFileTypes: true });
        for (const ent of entries) {
          const s = path.join(src, ent.name);
          const d = path.join(dst, ent.name);
          if (ent.isFile() && ent.name === 'env.yaml') {
            logInfo('排除: config/env.yaml');
            continue;
          }
          if (ent.isDirectory()) {
            await copyRecursive(s, d);
          } else if (ent.isFile()) {
            await fsp.copyFile(s, d);
          }
        }
      } else {
        await copyRecursive(src, dst);
      }
    } else {
      logWarn(`跳过（不存在）: ${item}`);
    }
  }

  // 写入启动脚本
  const startBat = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'if not exist "bin\\node.exe" (',
    '  echo [ERROR] 未找到 bin\\node.exe',
    '  pause',
    '  exit /b 1',
    ')',
    '.\\bin\\node.exe app\\main.js %*',
    'endlocal',
    ''
  ].join('\r\n');
  await fsp.writeFile(path.join(PortableDir, 'start.bat'), startBat, 'utf8');

  const startDebugBat = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'if not exist "app\\data\\logs" mkdir "app\\data\\logs"',
    'set LOG=app\\data\\logs\\console.log',
    'echo ==== %DATE% %TIME% START ==== >> "%LOG%"',
    '.\\bin\\node.exe app\\main.js --diag-on-error %* >> "%LOG%" 2>&1',
    'set EC=%ERRORLEVEL%',
    'echo ==== %DATE% %TIME% END (exit %EC%) ==== >> "%LOG%"',
    'if %EC% NEQ 0 (',
    '  echo 程序返回错误码 %EC%，详见 "%LOG%"',
    '  pause',
    ')',
    'endlocal',
    'exit /b %EC%',
    ''
  ].join('\r\n');
  await fsp.writeFile(path.join(PortableDir, 'start_debug.bat'), startDebugBat, 'utf8');

  // 生成构建元数据
  const pkgJsonPath = path.join(root, 'package.json');
  let version = '0.0.0';
  if (await pathExists(pkgJsonPath)) {
    try { version = JSON.parse(await fsp.readFile(pkgJsonPath, 'utf8')).version || version; } catch {}
  }
  const meta = {
    buildTime: new Date().toISOString(),
    nodeExe: nodeExePath,
    nodeVersion: spawnSync(nodeExePath, ['-v']).stdout?.toString().trim() || '',
    root,
    portableDir: PortableDir,
  };
  await fsp.writeFile(path.join(BuildDir, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');
  logInfo(`已生成元数据: ${path.join(BuildDir, 'metadata.json')}`);

  // NSIS 打包（可选）
  const ts = nowTs();
  const outExe = path.join(PackagedDir, `工具安装器-${version}-${ts}.exe`);
  const nsisScript = path.join(scriptDir, 'installer.nsi');
  const nsisExists = await pathExists(nsisScript);
  if (!nsisExists) {
    logWarn('缺少 BuildScript/installer.nsi，跳过 NSIS 打包');
  } else {
    const mk = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['makensis'], { encoding: 'utf8' });
    const hasNsis = mk.status === 0;
    if (!hasNsis) {
      logWarn('未检测到 makensis（NSIS），已生成便携目录，跳过安装包');
    } else {
      logInfo('开始 NSIS 打包...');
      const res = spawnSync('makensis', [
        '/INPUTCHARSET', 'UTF8',
        `/DPORTABLE_DIR=${PortableDir}`,
        `/DOUT_EXE=${outExe}`,
        nsisScript,
      ], { stdio: 'inherit' });
      if (res.status === 0) {
        logInfo(`NSIS 输出: ${outExe}`);
      } else {
        logWarn('NSIS 打包失败，已生成便携目录');
      }
    }
  }

  console.log('完成。');
}

main().catch((err) => {
  logErr(err && err.stack ? err.stack : String(err));
  process.exit(1);
});


