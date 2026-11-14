; Instalador do PokeIdle Manager (Inno Setup 6). Gerado no CI a cada tag:
;   iscc /DAppVersion=1.7.0 deploy\windows\installer.iss   ->   dist\PokeIdleManager-Setup.exe
; Instala só para o usuário atual (sem pedir administrador), o que permite atualizar em silêncio.
; Contas e tokens ficam em %LOCALAPPDATA%\PokeIdleManager e NÃO são apagados ao atualizar ou desinstalar.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B1F6C52-7C0E-4E0B-9B52-0F6B0C6B1A11}
AppName=PokeIdle Manager
AppVersion={#AppVersion}
AppPublisher=DiuleJR
DefaultDirName={localappdata}\Programs\PokeIdleManager
DefaultGroupName=PokeIdle Manager
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\..\dist
OutputBaseFilename=PokeIdleManager-Setup
SetupIconFile=..\..\web\public\favicon.ico
UninstallDisplayIcon={app}\PokeIdleManager.exe
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
WizardStyle=modern

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar um atalho na área de trabalho"; GroupDescription: "Atalhos:"
Name: "autostart"; Description: "Iniciar com o Windows (o bot volta sozinho depois de reiniciar o PC)"; GroupDescription: "Opções:"

[Files]
Source: "..\..\dist\PokeIdleManager\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\PokeIdle Manager"; Filename: "{app}\PokeIdleManager.exe"
Name: "{autodesktop}\PokeIdle Manager"; Filename: "{app}\PokeIdleManager.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PokeIdleManager"; ValueData: """{app}\PokeIdleManager.exe"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
; instalação normal: oferece abrir; atualização em silêncio (pelo painel): abre sozinho
Filename: "{app}\PokeIdleManager.exe"; Description: "Abrir o PokeIdle Manager"; Flags: nowait postinstall skipifsilent
Filename: "{app}\PokeIdleManager.exe"; Flags: nowait; Check: WizardSilent
