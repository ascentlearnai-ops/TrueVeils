[Setup]
AppName=Truveil Secure Interview
AppVersion=1.0
DefaultDirName={autopf}\Truveil Secure
DefaultGroupName=Truveil Secure
OutputBaseFilename=TruveilSecure-Setup
Compression=lzma2
SolidCompression=yes
OutputDir=d:\TrueVeils\backend\public\files
PrivilegesRequired=lowest

[Files]
Source: "d:\TrueVeils\dist_candidate\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Truveil Secure"; Filename: "{app}\TruveilSecure.exe"

[Run]
Filename: "{app}\TruveilSecure.exe"; Description: "Launch Secure Interview"; Flags: nowait postinstall skipifsilent
