!include LogicLib.nsh

!define ECLIPSE_ELECTRON_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\1cee5ad5-fb20-5488-b349-ffcaaa593158"
!define ECLIPSE_ELECTRON_KEY "Software\1cee5ad5-fb20-5488-b349-ffcaaa593158"
!define ECLIPSE_ELECTRON_UNINSTALLER "Uninstall Eclipse.exe"
!define ECLIPSE_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define ECLIPSE_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define ECLIPSE_STARTUP_NAME "Eclipse"

Var EclipseElectronStartup

!macro NSIS_HOOK_PREINSTALL
  StrCpy $EclipseElectronStartup ""
  ReadRegStr $R6 HKCU "${ECLIPSE_ELECTRON_UNINSTALL_KEY}" "UninstallString"
  ReadRegStr $R7 HKCU "${ECLIPSE_ELECTRON_KEY}" "InstallLocation"
  ${If} $R6 != ""
  ${AndIf} $R7 != ""
  ${AndIf} ${FileExists} "$R7\${ECLIPSE_ELECTRON_UNINSTALLER}"
    ReadRegStr $EclipseElectronStartup HKCU "${ECLIPSE_RUN_KEY}" "${ECLIPSE_STARTUP_NAME}"
    InitPluginsDir
    CopyFiles /SILENT "$R7\${ECLIPSE_ELECTRON_UNINSTALLER}" "$PLUGINSDIR\eclipse-electron-uninstall.exe"
    ClearErrors
    ExecWait '"$PLUGINSDIR\eclipse-electron-uninstall.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$R7' $R8
    ${If} ${Errors}
    ${OrIf} $R8 != 0
      MessageBox MB_ICONSTOP|MB_OK "Não foi possível remover o Eclipse antigo. Saia dele pela bandeja e rode o Setup de novo.$\r$\n$\r$\nCould not remove the old Eclipse. Quit it from the tray and run Setup again." /SD IDOK
      Abort
    ${EndIf}
    RMDir "$R7"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $EclipseElectronStartup != ""
    WriteRegStr HKCU "${ECLIPSE_RUN_KEY}" "${ECLIPSE_STARTUP_NAME}" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${ECLIPSE_APPROVED_KEY}" "${ECLIPSE_STARTUP_NAME}"
  ${EndIf}
!macroend
