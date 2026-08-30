# Gera os recursos VS_VERSION_INFO (.syso) dos dois binarios do coletor.
#
#   .\gerar-versioninfo.ps1            gera os .syso
#   .\gerar-versioninfo.ps1 -Conferir  so confere se estao em dia (nao escreve)
#
# ---------------------------------------------------------------------------------------------
# POR QUE EXISTE (30/08/2026)
# ---------------------------------------------------------------------------------------------
# Binario Go nao gera recurso de versao por padrao: o .exe sai sem nome de empresa, sem nome de
# produto e sem versao. Isso e' um dos sinais que os motores heuristicos usam, e o coletor ja'
# tem varios outros por construcao (copia a si mesmo para %LOCALAPPDATA%, grava autostart em
# HKCU\Run, roda sem janela e se auto-atualiza baixando um executavel).
#
# Medido no VirusTotal com o binario da v0.13.0: 4 de 71 motores acusavam, TODOS por heuristica.
# O unico que importa e' o Microsoft (`Trojan:Win32/Wacatac.B!ml` - o sufixo `!ml` e' veredito de
# machine learning, nao assinatura), porque o Defender e' o que apaga o arquivo nas maquinas.
#
# ⚠️ ISTO NAO SUBSTITUI ASSINATURA DIGITAL. Melhora os sinais; nao resolve. O que resolve de vez
# e' certificado de code signing - e enquanto nao houver, cada release e' um binario novo, com
# hash novo, sujeito a ser reavaliado do zero.
#
# ---------------------------------------------------------------------------------------------
# FONTE UNICA DA VERSAO
# ---------------------------------------------------------------------------------------------
# ⚠️ A versao NAO e' escrita nos versioninfo.json. Ela vem de `ciclo.Versao` (ciclo/ciclo.go), a
# mesma constante que o app compara com `GET /api/coletor-rep/tray-version` para saber que existe
# atualizacao. Duplicar o numero criaria um quarto lugar para esquecer de bumpar - o CLAUDE.md ja
# registra que esquecer UM dos lugares deixa o app achando que esta atualizado.
#
# ORDEM DE RELEASE (CLAUDE.md), com o passo novo em [ ]:
#   bump ciclo.Versao -> [ .\gerar-versioninfo.ps1 ] -> recompilar os dois .exe ->
#   escrever dist\VERSION -> npm run build -> conferir -> commitar juntos

param([switch]$Conferir)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# --- versao, lida da fonte unica -------------------------------------------------------------
$cicloGo = Join-Path $PSScriptRoot 'ciclo\ciclo.go'
if (-not (Test-Path $cicloGo)) { throw "ABORTADO: nao achei $cicloGo" }

$m = Select-String -Path $cicloGo -Pattern 'const\s+Versao\s*=\s*"([0-9]+)\.([0-9]+)\.([0-9]+)"'
if (-not $m) { throw "ABORTADO: nao consegui ler 'const Versao' de ciclo/ciclo.go" }
$maj, $min, $pat = [int]$m.Matches[0].Groups[1].Value, [int]$m.Matches[0].Groups[2].Value, [int]$m.Matches[0].Groups[3].Value
$versao = "$maj.$min.$pat"
Write-Host "versao (de ciclo.Versao): $versao"

# ⚠️ dist\VERSION tem que bater: e' o que a rota tray-version publica, e o app compara com
# ciclo.Versao. Divergencia ali faz o parque achar que ja esta atualizado (ou oferecer update
# para a mesma versao) - o CLAUDE.md registra isso como armadilha do release.
$distVersion = Join-Path $PSScriptRoot 'dist\VERSION'
if (Test-Path $distVersion) {
    $dv = (Get-Content -Raw $distVersion).Trim()
    if ($dv -ne $versao) {
        throw "ABORTADO: dist\VERSION diz '$dv' mas ciclo.Versao diz '$versao'. Alinhe os dois antes de gerar."
    }
}

# --- ferramenta ------------------------------------------------------------------------------
$gvi = Get-Command goversioninfo -ErrorAction SilentlyContinue
if (-not $gvi) {
    $candidato = Join-Path (& go env GOPATH) 'bin\goversioninfo.exe'
    if (Test-Path $candidato) { $gvi = $candidato } else {
        throw "ABORTADO: goversioninfo nao encontrado. Instale com:`n  go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest"
    }
} else { $gvi = $gvi.Source }

# --- geracao ---------------------------------------------------------------------------------
# O .syso e' pego automaticamente pelo linker do Go quando esta no diretorio do pacote main.
$alvos = @(
    @{ Dir = 'cmd\tray'; Nome = 'coletor-rep-tray' },
    @{ Dir = 'cmd\cli';  Nome = 'coletor-rep-cli'  }
)

$divergiu = $false
foreach ($a in $alvos) {
    $dir = Join-Path $PSScriptRoot $a.Dir
    $syso = Join-Path $dir 'resource.syso'

    if ($Conferir) {
        if (-not (Test-Path $syso)) { Write-Host "  FALTA    $($a.Dir)\resource.syso"; $divergiu = $true; continue }
        # O recurso guarda a versao em UTF-16; procura a string crua nos bytes do arquivo.
        $bytes = [System.IO.File]::ReadAllBytes($syso)
        $u16 = [System.Text.Encoding]::Unicode.GetString($bytes)
        if ($u16 -notmatch [regex]::Escape("$versao.0")) {
            Write-Host "  DESATUAL $($a.Dir)\resource.syso  (nao contem $versao.0)"; $divergiu = $true
        } else {
            Write-Host "  ok       $($a.Dir)\resource.syso  ($versao.0)"
        }
        continue
    }

    Push-Location $dir
    try {
        & $gvi -o resource.syso `
            -ver-major $maj -ver-minor $min -ver-patch $pat -ver-build 0 `
            -product-ver-major $maj -product-ver-minor $min -product-ver-patch $pat -product-ver-build 0 `
            -file-version "$versao.0" -product-version "$versao.0" `
            versioninfo.json
        if ($LASTEXITCODE -ne 0) { throw "goversioninfo falhou em $($a.Dir)" }
        $kb = [math]::Round((Get-Item resource.syso).Length / 1KB, 1)
        Write-Host "  gerado   $($a.Dir)\resource.syso  ($kb KB, versao $versao.0)"
    } finally { Pop-Location }
}

if ($Conferir) {
    if ($divergiu) {
        Write-Host "`nREPROVADO: rode .\gerar-versioninfo.ps1 e recompile os .exe." -ForegroundColor Red
        exit 1
    }
    Write-Host "`nAPROVADO: os .syso estao na versao $versao." -ForegroundColor Green
    exit 0
}

Write-Host "`nAgora recompile os dois binarios - o .syso so entra no .exe no proximo build:"
Write-Host '  go build -o dist\coletor-rep-cli.exe .\cmd\cli'
Write-Host '  go build -ldflags="-H=windowsgui" -o dist\coletor-rep-tray.exe .\cmd\tray'
