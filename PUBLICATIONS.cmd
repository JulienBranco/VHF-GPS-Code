@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est requis pour les outils de developpement. Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)
node "%~dp0tools\publications.cjs"
if errorlevel 1 pause
