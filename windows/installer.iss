; Installer for the WintrChess Windows app, built by build-exe.mjs.
; Installs for the current user by default, so no administrator rights
; are needed.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6E0B4C1E-5A2F-4C61-9C1B-3F0D7A9E2B57}
AppName=WintrChess
AppVersion={#AppVersion}
AppPublisher=WintrChess
AppPublisherURL=https://github.com/OronShalev/wintrchess
DefaultDirName={autopf}\WintrChess
DefaultGroupName=WintrChess
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=.
OutputBaseFilename=WintrChess-Setup
SetupIconFile=WintrChess\app.ico
UninstallDisplayIcon={app}\WintrChess.exe
UninstallDisplayName=WintrChess
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
Type: filesandordirs; Name: "{localappdata}\WintrChess"

[Icons]
Name: "{autoprograms}\WintrChess"; Filename: "{app}\WintrChess.exe"
Name: "{autodesktop}\WintrChess"; Filename: "{app}\WintrChess.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\WintrChess.exe"; Description: "{cm:LaunchProgram,WintrChess}"; Flags: nowait postinstall skipifsilent
