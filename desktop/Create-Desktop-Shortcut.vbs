Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strCurrentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set oShortcut = WshShell.CreateShortcut(strDesktop & "\Pain.lnk")
oShortcut.TargetPath = strCurrentDir & "\Pain.exe"
oShortcut.WorkingDirectory = strCurrentDir
oShortcut.IconLocation = strCurrentDir & "\assets\app-icon.ico, 0"
oShortcut.Description = "Pain — Minimalist Audio Player"
oShortcut.Save
MsgBox "Ярлык Pain с иконкой успешно создан на рабочем столе!", 64, "Pain"
