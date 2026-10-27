#!/usr/bin/env python3
"""
tools/patch_windows_exe.py
Brands a Windows pkg executable with an application icon, metadata, and patches
the PE subsystem from Console (CUI = 3) to Windows GUI (GUI = 2) so that
no command prompt / console window pops up when running on Windows.
"""

import sys
import os
import re
import shutil
import subprocess
import tempfile

def patch_executable(input_exe, output_exe=None, icon_path=None, version="1.8.1.0"):
    if output_exe is None:
        output_exe = input_exe

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    if icon_path is None:
        icon_path = os.path.join(repo_root, "desktop", "assets", "app-icon.ico")

    rcedit_exe = os.path.join(script_dir, "rcedit-x64.exe")
    if not os.path.exists(rcedit_exe):
        raise FileNotFoundError(f"rcedit binary not found at: {rcedit_exe}")

    with open(input_exe, "rb") as f:
        data = f.read()

    # Find pkg payload positions
    m_payload = re.search(rb"PAYLOAD_POSITION\s*=\s*'([0-9 ]+)'", data)
    m_prelude = re.search(rb"PRELUDE_POSITION\s*=\s*'([0-9 ]+)'", data)

    if not m_payload or not m_prelude:
        raise ValueError("Could not find PAYLOAD_POSITION or PRELUDE_POSITION in executable")

    old_payload_str = m_payload.group(1)
    old_prelude_str = m_prelude.group(1)

    base_size = int(old_payload_str.strip())
    prelude_pos = int(old_prelude_str.strip())
    prelude_delta = prelude_pos - base_size

    print(f"[1/5] Parsed pkg header: base_size={base_size}, prelude_pos={prelude_pos}, total_size={len(data)}")

    pe_part = data[:base_size]
    payload_part = data[base_size:]

    # Work in temporary directory
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_pe = os.path.join(tmpdir, "base_pe.exe")
        with open(temp_pe, "wb") as f:
            f.write(pe_part)

        print("[2/5] Running rcedit to embed icon and application metadata...")
        rcedit_cmd = [
            rcedit_exe, temp_pe,
            "--set-icon", icon_path,
            "--set-version-string", "FileDescription", "Pain - Minimalist Audio Player",
            "--set-version-string", "ProductName", "Pain",
            "--set-version-string", "CompanyName", "Ivan",
            "--set-version-string", "LegalCopyright", "Copyright (C) 2026 Ivan",
            "--set-version-string", "OriginalFilename", "Pain.exe",
            "--set-file-version", version,
            "--set-product-version", version
        ]

        if os.name != 'nt':
            rcedit_cmd = ['wine'] + rcedit_cmd

        res = subprocess.run(rcedit_cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(res.stdout)
            print(res.stderr)
            raise RuntimeError(f"rcedit failed with exit code {res.returncode}")

        with open(temp_pe, "rb") as f:
            new_pe = bytearray(f.read())

    new_base_size = len(new_pe)
    new_prelude_pos = new_base_size + prelude_delta

    print(f"[3/5] Base PE resized from {base_size} to {new_base_size} bytes.")

    # Format new placeholder strings with exact matching width
    new_payload_str = str(new_base_size).ljust(len(old_payload_str)).encode("ascii")
    new_prelude_str = str(new_prelude_pos).ljust(len(old_prelude_str)).encode("ascii")

    idx1 = new_pe.find(old_payload_str)
    idx2 = new_pe.find(old_prelude_str)

    if idx1 == -1 or idx2 == -1:
        raise ValueError(f"Could not locate payload placeholder byte patterns in branded base PE")

    new_pe[idx1:idx1+len(new_payload_str)] = new_payload_str
    new_pe[idx2:idx2+len(new_prelude_str)] = new_prelude_str

    # Reattach payload
    full_exe = bytearray(new_pe) + payload_part

    print("[4/5] Patching PE Subsystem to IMAGE_SUBSYSTEM_WINDOWS_GUI (2)...")
    pe_offset = int.from_bytes(full_exe[0x3c:0x40], "little")
    subsystem_offset = pe_offset + 4 + 20 + 68
    full_exe[subsystem_offset:subsystem_offset+2] = (2).to_bytes(2, "little")

    # Verify subsystem
    verified_subsystem = int.from_bytes(full_exe[subsystem_offset:subsystem_offset+2], "little")
    assert verified_subsystem == 2, f"Failed to patch subsystem, got {verified_subsystem}"

    print(f"[5/5] Writing branded GUI executable ({len(full_exe)} bytes) to: {output_exe}")
    with open(output_exe, "wb") as f:
        f.write(full_exe)

    print("Successfully branded and patched executable!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <input_exe> [output_exe]")
        sys.exit(1)
    in_file = sys.argv[1]
    out_file = sys.argv[2] if len(sys.argv) > 2 else in_file
    patch_executable(in_file, out_file)
