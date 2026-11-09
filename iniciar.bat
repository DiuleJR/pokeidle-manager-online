@echo off
setlocal
cd /d "%~dp0"
title Pokeidle Manager

rem Uso: iniciar.bat            instala (na 1a vez) e inicia o bot e o painel
rem      iniciar.bat atualizar  baixa a versao nova do projeto antes de iniciar

set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY goto :sem_python

%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"
if errorlevel 1 goto :python_antigo

if /i "%~1"=="atualizar" call :atualizar
if errorlevel 1 goto :erro

if exist "venv\Scripts\python.exe" goto :deps
echo Criando o ambiente Python (so na primeira vez)...
%PY% -m venv venv
if errorlevel 1 goto :erro

:deps
echo Verificando as dependencias do bot...
"venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 goto :erro

if exist "web_dist\index.html" goto :rodar
where npm >nul 2>nul
if errorlevel 1 goto :sem_node
call :dashboard
if errorlevel 1 goto :erro

:rodar
echo.
echo Iniciando. Abra http://localhost:8080 no navegador.
echo Na primeira vez, o painel pede para voce criar uma senha.
echo Para parar, feche esta janela ou aperte Ctrl+C.
echo.
"venv\Scripts\python.exe" -u main.py
goto :fim

:sem_node
echo.
echo O Node.js nao esta instalado: tentando baixar o dashboard ja compilado...
"venv\Scripts\python.exe" scripts\get_dashboard.py
if not errorlevel 1 goto :rodar
echo.
echo [aviso] Nao consegui obter o dashboard. Instale o Node.js 18 ou mais novo em https://nodejs.org
echo         e rode este arquivo de novo. O bot vai iniciar mesmo assim, mas sem a tela do painel.
echo.
goto :rodar

:atualizar
where git >nul 2>nul
if errorlevel 1 (
  echo [erro] O Git nao foi encontrado.
  exit /b 1
)
echo Baixando a versao nova...
git pull --ff-only
if errorlevel 1 exit /b 1
if exist "web_dist" rmdir /s /q "web_dist"
exit /b 0

:dashboard
echo Compilando o dashboard (leva de 1 a 2 minutos)...
pushd web
call npm ci --silent
if errorlevel 1 (
  popd
  exit /b 1
)
call npm run build --silent
if errorlevel 1 (
  popd
  exit /b 1
)
popd
xcopy /e /i /y /q "web\dist" "web_dist" >nul
exit /b 0

:sem_python
echo [erro] O Python nao foi encontrado.
echo        Instale o Python 3.12 ou mais novo em https://www.python.org/downloads/
echo        e marque a opcao "Add python.exe to PATH" na instalacao.
goto :erro

:python_antigo
echo [erro] E preciso o Python 3.12 ou mais novo.
goto :erro

:erro
echo.
echo Algo deu errado (veja a mensagem acima). Veja o guia INSTALACAO.md.
pause
exit /b 1

:fim
echo.
echo O Pokeidle Manager foi encerrado.
pause
