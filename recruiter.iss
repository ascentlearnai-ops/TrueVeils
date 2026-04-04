[Setup]
AppName=Truveil
AppVersion=1.0
DefaultDirName={autopf}\Truveil
DefaultGroupName=Truveil
OutputBaseFilename=TruveilRecruiter-Setup
Compression=lzma2
SolidCompression=yes
OutputDir=d:\TrueVeils\landing
PrivilegesRequired=lowest

[Files]
Source: "d:\TrueVeils\dist_recruiter\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Truveil"; Filename: "{app}\TruveilRecruiter.exe"

[Run]
Filename: "{app}\TruveilRecruiter.exe"; Description: "Launch Truveil"; Flags: nowait postinstall skipifsilent
