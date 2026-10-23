; Installer for the OronChess Windows app, built by build-exe.mjs.
; Installs for the current user by default, so no administrator rights
; are needed.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{50CB9F9E-D945-4CF1-A18A-A34FA19BC563}
AppName=OronChess
AppVersion={#AppVersion}
AppPublisher=OronChess
AppPublisherURL=https://github.com/OronShalev/oronchess
DefaultDirName={autopf}\OronChess
DefaultGroupName=OronChess
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=.
OutputBaseFilename=OronChess-Setup
SetupIconFile=OronChess\app.ico
UninstallDisplayIcon={app}\OronChess.exe
UninstallDisplayName=OronChess
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "build\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Old web files are replaced on update rather than left behind
Type: filesandordirs; Name: "{app}\www"

[UninstallDelete]
; Browser data, including saved evaluations
Type: filesandordirs; Name: "{localappdata}\OronChess"

[Icons]
Name: "{autoprograms}\OronChess"; Filename: "{app}\OronChess.exe"
Name: "{autodesktop}\OronChess"; Filename: "{app}\OronChess.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\OronChess.exe"; Description: "{cm:LaunchProgram,OronChess}"; Flags: nowait postinstall skipifsilent
