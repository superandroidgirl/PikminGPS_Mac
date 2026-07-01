#!/usr/bin/env python3
"""定義性檢查：對 site-packages 內每個 Mach-O 的每個 arch slice，
確認它參照的每個 @loader_path/@rpath bundled dylib 都含該 slice 的架構。"""
import subprocess, os, site, sys, re

sp = site.getsitepackages()[0]
ARCHES = ("arm64", "x86_64")

def slices(path):
    out = subprocess.run(["file", "-b", path], capture_output=True, text=True).stdout
    return [a for a in ARCHES if a in out]

def deps(path, arch):
    out = subprocess.run(["otool", "-arch", arch, "-L", path],
                         capture_output=True, text=True).stdout
    res = []
    for line in out.splitlines()[1:]:
        m = line.strip().split(" ")[0]
        if m.startswith("@loader_path") or m.startswith("@rpath") or (not m.startswith("/") and m):
            res.append(m)
    return res

def resolve(mach, ref):
    d = os.path.dirname(mach)
    ref = ref.replace("@loader_path", d).replace("@rpath", d)
    return os.path.normpath(ref)

problems = []
count = 0
for dirpath, _, files in os.walk(sp):
    if "/delocate/tests/" in dirpath + "/":
        continue
    for f in files:
        if not f.endswith((".so", ".dylib")):
            continue
        p = os.path.join(dirpath, f)
        count += 1
        base = f  # e.g. _rust.abi3.so
        for arch in slices(p):
            for ref in deps(p, arch):
                # 跳過模組自身的 install ID（@rpath/<dotted.module>.so 指向自己）
                if ref.split("/")[-1].endswith(base):
                    continue
                tgt = resolve(p, ref)
                if not os.path.exists(tgt):
                    problems.append(f"{p} [{arch}] -> 缺檔 {ref}")
                elif arch not in slices(tgt):
                    problems.append(f"{p} [{arch}] -> {ref} 不含 {arch}")

print(f"檢查 {count} 個 Mach-O 檔（排除 delocate/tests）")
if problems:
    print(f"\n發現 {len(problems)} 個 slice 依賴不符：")
    for x in problems:
        print("  " + x)
    sys.exit(1)
print("✅ 所有 slice 的 bundled 依賴都含對應架構——universal 相依性完整。")
