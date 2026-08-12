# Higiene de cadastros do dispositivo REP (Fase 7b) — 12/08/2026

## Contexto

Primeira instalação real fora do piloto da TI: o coletor foi instalado na LACEN e o usuário
testou por lá, colando o log de sync (`coletor-rep.log`) para revisão. Duas dúvidas ficaram:
como tratar cadastros antigos de usuário que sobraram de um sistema anterior (o relógio é
reaproveitado, não novo), e como tratar o histórico de marcação antigo que porventura já
estivesse no equipamento.

## O que o log mostrou

- O ciclo das 08:38 puxou o histórico inteiro do relógio (NSR 1–35.841, ~34.500 registros tipo 3)
  porque `sync` sempre pede a partir do NSR 1 (já documentado como pendência no plano original).
  Em **todo** lote, `marcacoes == orfas` — nenhuma dessas marcações foi atribuída a nenhum
  servidor, porque `rep_vinculos_servidor` só ganhou os dois primeiros vínculos (GISELE,
  LEILANE) às 08:59:41, depois de todo o histórico já ter sido ingerido. Ou seja: dado histórico
  de relógio reaproveitado é inofensivo por construção — nunca escreve em `escala_diaria` sem
  vínculo.
- O log "repetindo" os mesmos 35.841 registros a cada ciclo de 5 minutos não estava duplicando
  nada no banco — é `fn_ingerir_afd` devolvendo o atalho de idempotência por lote (`reenvio:
  true`, reaproveitando os números já salvos), e o log do coletor não distingue isso de
  reprocessamento de verdade. Confirmado pelo lote final às 08:59:59, que mudou de UUID (2
  batidas novas de verdade apareceram) e reportou corretamente `novas=2 duplicadas=341`. Mas
  confirma ao vivo, com volume real, o item que o CLAUDE.md já registrava como pendência —
  candidato a próxima prioridade.

## Decisão sobre "zerar o relógio"

Recomendado **não construir** essa opção: a memória do AFD é desenhada para ser inviolável — é o
que dá ao REP-C valor como prova legal (Portaria 671/2021) — e não há confirmação de que a API
do equipamento sequer exponha uma operação de reset. Como o histórico não vinculado já é
inofensivo (ver acima), não há necessidade funcional de apagar nada ali. O problema real e
tratável é só o **cadastro de usuário** desatualizado no equipamento — isso sim é dado
gerenciável pela mesma família de API já validada na Fase 7.

## O que foi construído

Ver `CLAUDE.md`, seção "Fase 7b — higiene de cadastros do dispositivo", para o desenho completo
(tabelas, RPCs, rotas, guard de segurança). Resumo:

- `rep_usuarios_dispositivo` (snapshot) + `rep_remocoes_fila` (fila de remoção), migration
  `20260812040000_add_rep_higiene_cadastros_dispositivo.sql`.
- `fn_enfileirar_remocao_usuarios_dispositivo` recusa remover quem tem `rep_vinculos_servidor`
  vigente para um servidor Ativo — guard na RPC, não só na tela.
- Rotas `/api/rep/v1/usuarios-dispositivo` (POST, snapshot) e `/api/rep/v1/remocoes`
  (GET/POST, fila) — mesmo esquema de autenticação das demais rotas do coletor.
- Coletor Go: `rep.ListarUsuarios` (refactor de `ListarUsuariosComBiometria`, que virou filtro
  em cima dela) e `rep.RemoverUsuario` (`remove_users.fcgi`, **não confirmada contra hardware
  real** — corpo por simetria com `load_users.fcgi`). Subcomandos `coletor-rep higiene` (leitura,
  no menu da bandeja também) e `coletor-rep higiene-remover` (escreve/apaga, só CLI).
- Tela "Higiene do Relógio" em `/marcacoes` (admin/super_admin): lista quem está no relógio,
  classifica por vínculo ativo / correspondência por CPF sem vínculo / sem correspondência
  (único caso selecionável para remoção), e permite marcar candidatos para a fila.

## Por que remoção não entrou na bandeja

`rep.RemoverUsuario` nunca foi testada contra o device real — ao contrário de
`add_users`/`load_users.fcgi`, que passaram por cinco rodadas de teste na Fase 7 antes de
qualquer botão automático. Escrita (criar usuário) já era arriscada o bastante para ficar de
fora do ciclo automático; apagar cadastro de verdade é estritamente mais arriscado. Antes de
confiar nisso em produção, validar `coletor-rep higiene-remover` contra um usuário de teste (o
mesmo "SISESCALA TESTE - PODE APAGAR" que `cadastros-testar` cria).

## Pendências

- Validar `RemoverUsuario`/`remove_users.fcgi` contra hardware real.
- Priorizar a correção do `sync` para retomar de `dispositivos_rep.ultimo_nsr` em vez de sempre
  pedir o AFD a partir do NSR 1 — confirmado ao vivo nesta sessão que reprocessa ~36 mil linhas
  a cada ciclo de 5 minutos.
- Recompilar/commitar `dist/coletor-rep-cli.exe` e `dist/coletor-rep-tray.exe` a cada mudança
  futura em `cmd/cli`/`cmd/tray` ou nos pacotes que importam (feito nesta sessão para os
  subcomandos `higiene`/`higiene-remover`).
