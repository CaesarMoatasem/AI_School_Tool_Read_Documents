@echo off
REM Starts the local Firestore emulator that Examline talks to in development.
REM Leave this window open while you use the app, then run "npm start" in a second terminal.
REM
REM The emulator needs Java 21 or newer. If the system "java" is older or missing, this
REM falls back to the JRE 21 shipped by the VS Code "Language Support for Java" extension.

setlocal enabledelayedexpansion

set "JMAJOR=0"
for /f "tokens=3" %%v in ('java -version 2^>^&1 ^| findstr /i "version"') do set "JVER=%%v"
if defined JVER (
  set "JVER=!JVER:"=!"
  for /f "delims=._-" %%a in ("!JVER!") do set "JMAJOR=%%a"
)
echo Detected system Java major version: !JMAJOR!

if !JMAJOR! GEQ 21 goto :run

REM "for /d" only expands a wildcard in the final path segment, so walk it in two steps.
set "JRE21="
for /d %%E in ("%USERPROFILE%\.vscode\extensions\redhat.java-*") do (
  for /d %%J in ("%%E\jre\21*") do set "JRE21=%%J"
)
if not defined JRE21 (
  echo.
  echo The Firestore emulator needs Java 21 or newer, and none was found.
  echo Install it with:  winget install EclipseAdoptium.Temurin.21.JDK
  echo.
  exit /b 1
)
echo Using bundled JRE 21 at "!JRE21!"
set "JAVA_HOME=!JRE21!"
set "PATH=!JRE21!\bin;%PATH%"

:run
cd /d "%~dp0"
if not exist ".emulator-data" mkdir ".emulator-data"
if "%1"=="--check" (
  echo Check only, not starting. JAVA_HOME=!JAVA_HOME!
  "!JAVA_HOME!\bin\java.exe" -version
  exit /b 0
)
npx firebase emulators:start --only firestore --project demo-examline --import=.emulator-data --export-on-exit

endlocal
