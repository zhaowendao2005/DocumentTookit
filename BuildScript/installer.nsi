!include "MUI2.nsh"

; 输入参数（由构建脚本传入）。只校验，不重复定义，避免重复 !define 报错
!ifndef PORTABLE_DIR
  !error "PORTABLE_DIR 未定义"
!endif

!ifdef OUT_EXE
  OutFile "${OUT_EXE}"
!else
  OutFile "工具安装器.exe"
!endif

!define APP_NAME "Batch LLM Processor"
InstallDir "$PROGRAMFILES\${APP_NAME}"
RequestExecutionLevel user
Icon "${__FILEDIR__}\..\asset\.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${PORTABLE_DIR}\*.*"

  ; 开始菜单
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\启动工具.lnk" "$INSTDIR\start.bat"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\启动工具(调试).lnk" "$INSTDIR\start_debug.bat"

  ; 可选：桌面快捷方式（注释默认关闭）
  ; CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\start.bat"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP_NAME}\启动工具.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\启动工具(调试).lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "$INSTDIR"
SectionEnd


