#ifndef MyAppVersion
  #define MyAppVersion "1.1.5"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Rehearsal"
#endif

[Setup]
AppId={{8D6B8E5C-4D32-4F62-B3DA-92A1E0A5C301}
AppName=Rehearsal
AppVersion={#MyAppVersion}
AppPublisher=Logan Shippee
DefaultDirName={localappdata}\Programs\Rehearsal
DefaultGroupName=Rehearsal
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\dist
OutputBaseFilename=Rehearsal-Setup
SetupIconFile=..\web\favicon.ico
UninstallDisplayIcon={app}\Rehearsal.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Rehearsal"; Filename: "{app}\Rehearsal.exe"
Name: "{group}\Uninstall Rehearsal"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Rehearsal"; Filename: "{app}\Rehearsal.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Rehearsal.exe"; Description: "{cm:LaunchProgram,Rehearsal}"; Flags: nowait postinstall skipifsilent
