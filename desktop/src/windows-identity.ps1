param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$IconPath)
$ErrorActionPreference='Stop'
# A browser-hosted app needs window identity, not just an icon on Pain.exe.
# https://learn.microsoft.com/windows/win32/properties/props-system-appusermodel-relaunchiconresource
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class PainWindowIdentity {
 [StructLayout(LayoutKind.Sequential)] public struct Key {public Guid format;public uint id;}
 [StructLayout(LayoutKind.Explicit,Size=24)] public struct Value {
  [FieldOffset(0)] public ushort type;
  [FieldOffset(8)] public IntPtr text;
 }
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface Store {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index,out Key key);
  [PreserveSig] int GetValue(ref Key key,out Value value);
  [PreserveSig] int SetValue(ref Key key,ref Value value);
  [PreserveSig] int Commit();
 }
 public delegate bool WindowCallback(IntPtr window,IntPtr unused);
 [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr unused);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out Store store);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string file,IntPtr context,uint flags,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out Store store);
 static void Set(Store store,uint id,string text) {
  var key=new Key{format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=id};
  var value=new Value{type=31,text=Marshal.StringToCoTaskMemUni(text)};
  try {Marshal.ThrowExceptionForHR(store.SetValue(ref key,ref value));}
  finally {Marshal.FreeCoTaskMem(value.text);}
 }
 public static void IdentifyShortcut(string file) {
  var iid=typeof(Store).GUID;Store store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(file,IntPtr.Zero,2,ref iid,out store));
  try {Set(store,5,"dev.pain.desktop");Marshal.ThrowExceptionForHR(store.Commit());}
  finally {Marshal.ReleaseComObject(store);}
 }
 public static int Apply(string exe,string icon) {
  int found=0;
  EnumWindows(delegate(IntPtr window,IntPtr unused) {
   if(!IsWindowVisible(window))return true;
   var title=new StringBuilder(512);GetWindowText(window,title,title.Capacity);
   // App-mode title only; never relabel an ordinary browser window/tab group.
   if(!title.ToString().Equals("Pain \u2014 Minimalist Audio Player",StringComparison.Ordinal))return true;
   uint pid;GetWindowThreadProcessId(window,out pid);
   try {
    string process=Process.GetProcessById((int)pid).ProcessName;
    if(!process.Equals("msedge",StringComparison.OrdinalIgnoreCase)&&!process.Equals("chrome",StringComparison.OrdinalIgnoreCase))return true;
    var iid=typeof(Store).GUID;Store store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref iid,out store));
    try {
     // Metadata first: Explorer must pin Pain.exe, not its browser host.
     Set(store,2,"\""+exe+"\"");Set(store,3,icon+",0");Set(store,4,"Pain");Set(store,5,"dev.pain.desktop");
     Marshal.ThrowExceptionForHR(store.Commit());found++;
    } finally {Marshal.ReleaseComObject(store);}
   } catch { /* A window may close while being enumerated. */ }
   return true;
  },IntPtr.Zero);
  return found;
 }
}
'@
try {
 $menu=[Environment]::GetFolderPath('Programs')
 $link=Join-Path $menu 'Pain.lnk'
 $shell=New-Object -ComObject WScript.Shell
 $shortcut=$shell.CreateShortcut($link)
 $shortcut.TargetPath=$Executable
 $shortcut.WorkingDirectory=[IO.Path]::GetDirectoryName($Executable)
 $shortcut.IconLocation=$IconPath+',0'
 $shortcut.Description='Pain'
 $shortcut.Save()
 [PainWindowIdentity]::IdentifyShortcut($link)
} catch { } # A locked Start menu must not prevent window branding.
# Bounded startup-only work, no resident helper or respawn loop.
$seenAt=-1
for($i=0;$i -lt 60;$i++){
 $found=[PainWindowIdentity]::Apply($Executable,$IconPath)
 if($found -gt 0 -and $seenAt -lt 0){$seenAt=$i}
 if($seenAt -ge 0 -and $i-$seenAt -ge 12){exit 0}
 Start-Sleep -Milliseconds 250
}
