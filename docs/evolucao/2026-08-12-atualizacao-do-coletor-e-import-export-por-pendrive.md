# Atualização semi-automática do coletor-rep + import/export por pendrive — 12/08/2026

## Contexto

Olhando a tela `/marcacoes` (aba Terminais Locais / Dispositivos REP), o usuário levantou três
pontos: (1) atualizar o app de bandeja em campo hoje exige rebaixar o `.zip` inteiro pelo botão
"Baixar aplicativo", o que gera um `config.yaml` novo — não existia jeito de só trocar o `.exe`
no lugar certo, nem de o app avisar sozinho que existe versão nova; (2) dúvida factual sobre se a
sincronização com o relógio é automática ou exige ação manual; (3) nem toda unidade tem rede até
o relógio (identificado ao instalar na LACEN), então faltava um caminho de import/export por
pendrive — pendência já registrada no plano original da Fase 6, nunca implementada.

Decisões confirmadas com o usuário antes de implementar:
- **Update: avisa e espera clique.** Nunca troca o próprio executável sem confirmação explícita —
  mesma cautela já aplicada a tudo que mexe nesse binário (o Smart App Control já bloqueou o
  `.exe` sem aviso uma vez, ver CLAUDE.md).
- **Pendrive: uso recorrente**, não ponte temporária única — precisa rastrear por dispositivo até
  onde já foi exportado, para nunca ter que levar o AFD inteiro (36 mil+ linhas na LACEN) de novo.

## Resposta à dúvida (2): a sincronização já é automática

`cmd/tray` roda um ciclo de 5 em 5 minutos (`Sync` + `Heartbeat`) sozinho, desde que o app esteja
aberto (ícone na bandeja) — não existe passo manual diário. O que o usuário via como possível
lacuna era justamente a falta de um aviso de atualização de versão, resolvida por este trabalho.

## O que foi construído

### 1. Atualização semi-automática do `coletor-rep-tray.exe`

Duas rotas novas, públicas (sem sessão — mesmo padrão de `GET /api/version`, que o terminal web
já usa para se auto-atualizar):

| rota | papel |
|---|---|
| `GET /api/coletor-rep/tray-version` | lê `tools/coletor-rep/dist/VERSION`, calcula sha256 do `.exe` atual em runtime, devolve `{ versao, sha256 }` |
| `GET /api/coletor-rep/tray-download` | devolve `coletor-rep-tray.exe` cru — mesmo corpo de `download-cli`, sem checagem de sessão |

`ciclo.VersaoDisponivel` (Go) faz um GET simples nessa rota e compara com `ciclo.Versao` local
por partes numéricas (não como string — evita `"0.10.0" < "0.9.0"`). `cmd/tray/main.go` checa no
máximo 1x/dia, habilita um item de menu "Atualização disponível" e dispara uma notificação
(`beeep`) quando há versão nova. O clique nesse item chama `ciclo.AplicarAtualizacao`, que baixa
o `.exe` novo para um arquivo temporário, **confere o sha256 antes de instalar** (recusa se não
bater — download corrompido não pode virar instalação), e reaproveita o mesmo padrão de
renomear-e-relançar já usado por `autoInstalarERelancar` (Windows permite renomear/mover um
`.exe` em execução, só não sobrescrever no lugar).

Ver `CLAUDE.md`, seção "Coletor Go", para o processo de release atualizado — `dist/VERSION`
passa a ser parte obrigatória de todo commit de binário novo, junto com `ciclo.Versao`.

### 2. Import/export de AFD por pendrive

Nenhuma migration foi necessária: `fn_ingerir_afd` já aceitava `p_canal = 'pendrive'` e
`p_importado_por` desde a Fase 0-3, sem nenhuma tela que os usasse.

- `coletor-rep-cli afd-exportar <arquivo>.sisrep` — novo subcomando. Lê um estado local
  (`estado-pendrive.json`, ao lado do `config.yaml` da máquina offline — nunca no banco, porque
  essa máquina por definição não tem caminho até lá) para saber a partir de que NSR exportar,
  grava um cabeçalho ASCII (dispositivo, faixa de NSR, timestamp) seguido dos bytes crus do AFD
  em ISO-8859-1 — sem decodificar, mesma preservação de `linha_bruta` como artefato legal. Só
  atualiza o estado local depois de escrever o arquivo com sucesso.
- Nova aba "Importar por Pendrive" em `/marcacoes` (admin): escolhe o dispositivo de origem,
  sobe o `.sisrep`, e a server action `importarPendriveAfd` (`marcacoes/actions.ts`) separa
  cabeçalho e corpo, decodifica o corpo de latin1, envia em lotes de 500 linhas para a mesma
  `fn_ingerir_afd` que o sync online usa, com `p_canal: 'pendrive'` e `p_importado_por` do admin
  logado. Reenviar o mesmo arquivo depois não duplica nada — idempotência por
  `(dispositivo_id, nsr)` já existente cobre isso.

⚠️ **Desvio do plano aprovado**: o plano original propunha uma Route Handler
(`POST /api/coletor-rep/pendrive-import`) para o import. Implementado como Server Action
(`importarPendriveAfd`) em vez disso — `FormData`+`File` é suportado nativamente por Server
Actions no App Router, e todo outro recurso admin de `/marcacoes` já usa `actions.ts`, não rota
manual. Primeiro upload de arquivo binário real do projeto; vira a referência para os próximos.

⚠️ **`fn_ingerir_afd` só é `GRANT`ada a `service_role`** (`REVOKE ALL ... FROM PUBLIC, anon,
authenticated`) — a action usa `createAdminClient()` especificamente para essa chamada, não o
`createClient()` de sessão normal (que teria `auth.getUser()` funcionando, mas cairia em
permissão negada na RPC).

## O que fica de fora deliberadamente

- Nenhuma mudança em `fn_ingerir_afd` nem em qualquer função de presença.
- O update continua exigindo clique humano — nunca aplica sozinho.
- Sem detecção de pendrive plugado (device USB) — o fluxo é sempre com caminho de arquivo
  explícito, tanto na exportação (CLI) quanto na importação (upload manual na tela).

## Pendente de validação com hardware/rede real

Diferente da Fase 7 (push de identidade), que passou por cinco rodadas de teste contra o relógio
real antes de ser dada como confirmada, este trabalho **não foi validado em campo** nesta sessão:
- `afd-exportar` nunca rodou contra um relógio real nem gerou um `.sisrep` de verdade.
- O botão de aplicar atualização nunca foi testado numa instalação real com versão antiga.
- As rotas `tray-version`/`tray-download` foram verificadas só por `npx tsc --noEmit` e
  `npm run build` (compilação), não por chamada real sem sessão.

Antes de considerar esta fase fechada, repetir o padrão já estabelecido no projeto: testar contra
hardware/rede reais, não confiar em revisão de código.
