#!/usr/bin/env python3
"""把 build venv 中所有『非 universal2』的原生檔，逐套件下載雙架構 wheel
以 delocate-merge 合併成 universal2 後覆寫安裝。全在 venv-uni 內操作。"""
import subprocess, sys, os, tempfile, glob
from importlib import metadata
import site

PY = "3.9"
PIP = [sys.executable, "-m", "pip"]
BINDIR = os.path.dirname(sys.executable)
DELOCATE_MERGE = os.path.join(BINDIR, "delocate-merge")
# 純 build 期工具，不會被打包進 app，略過
SKIP = {"delocate", "pyinstaller", "macholib", "altgraph"}

def is_universal(path):
    out = subprocess.run(["file", "-b", path], capture_output=True, text=True).stdout
    return "2 architectures" in out or "3 architectures" in out

def macho_files(root):
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith((".so", ".dylib")):
                yield os.path.join(dirpath, f)

sp = site.getsitepackages()[0]

# 1) 找出含非-universal 原生檔的 dist 套件
bad_dists = {}
for dist in metadata.distributions():
    name = dist.metadata["Name"]
    ver = dist.version
    if name.lower() in SKIP:
        continue
    files = dist.files or []
    for pf in files:
        p = str(pf.locate())
        if p.endswith((".so", ".dylib")) and os.path.exists(p) and not is_universal(p):
            bad_dists.setdefault((name, ver), []).append(p)

if not bad_dists:
    print("沒有需要合併的套件——全部已是 universal2。")
    sys.exit(0)

print("需合併為 universal2 的套件：")
for (n, v), fs in bad_dists.items():
    print(f"  {n}=={v}  ({len(fs)} 個原生檔)")
print()

# 2) 逐套件下載雙架構 wheel → delocate-merge → 覆寫安裝
for (name, ver), _ in bad_dists.items():
    with tempfile.TemporaryDirectory() as td:
        print(f"=== {name}=={ver} ===")
        for tag in ("macosx_15_0_arm64", "macosx_15_0_x86_64"):
            r = subprocess.run(PIP + ["download", "--no-deps", "--only-binary=:all:",
                                      "--platform", tag, "--python-version", PY,
                                      "-d", td, f"{name}=={ver}"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  [!] 下載 {tag} 失敗：\n{r.stdout}\n{r.stderr}")
                sys.exit(1)
        whls = sorted(glob.glob(os.path.join(td, "*.whl")))
        if len(whls) != 2:
            print(f"  [!] 預期 2 個 wheel，實得 {len(whls)}：{whls}")
            sys.exit(1)
        outdir = os.path.join(td, "merged")
        os.makedirs(outdir)
        r = subprocess.run([DELOCATE_MERGE, "-w", outdir] + whls,
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  [!] delocate-merge 失敗：\n{r.stdout}\n{r.stderr}")
            sys.exit(1)
        merged = glob.glob(os.path.join(outdir, "*.whl"))
        print(f"  合併 → {os.path.basename(merged[0])}")
        r = subprocess.run(PIP + ["install", "--force-reinstall", "--no-deps", "-q", merged[0]],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  [!] 安裝失敗：\n{r.stdout}\n{r.stderr}")
            sys.exit(1)
        print("  [OK] 已覆寫安裝")
print("\n全部合併完成。")
