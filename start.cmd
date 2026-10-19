@echo off
cd /d "%~dp0"
echo Starting Vertex Demo OPEX dashboard...
echo Local: http://localhost:3300
echo LAN:   http://YOUR-PC-IP:3300
node server.js
