Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strDesktop = WshShell.SpecialFolders("Desktop")
strCurrentDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set oShortcut = WshShell.CreateShortcut(strDesktop & "\Pain.lnk")
oShortcut.TargetPath = strCurrentDir & "\Pain.exe"
oShortcut.WorkingDirectory = strCurrentDir
If fso.FileExists(strCurrentDir & "\assets\app-icon.ico") Then
    oShortcut.IconLocation = strCurrentDir & "\assets\app-icon.ico, 0"
Else
    oShortcut.IconLocation = strCurrentDir & "\Pain.exe, 0"
End If
oShortcut.Description = "Pain — Minimalist Audio Player"
oShortcut.Save
MsgBox "Ярлык Pain с иконкой успешно создан на рабочем столе!", 64, "Pain"
