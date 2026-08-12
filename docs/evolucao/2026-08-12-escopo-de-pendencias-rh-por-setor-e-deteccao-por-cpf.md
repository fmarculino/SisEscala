# Escopo de pendências de RH por setor + detecção automática por CPF — 12/08/2026

## Contexto

Depois de liberar Pendências de Cadastro para coordenador (v1.51.0), o coordenador do piloto da
TI reportou continuar vendo "0" — nenhuma pendência, mesmo a unidade dele (SMS) tendo pendências
reais de importação do RH. Investigado com consultas diretas em produção (autorizadas pelo
usuário) em vez de suposição.

## Diagnóstico

```
importacao_rh_pendentes não promovidas: 3.361
  sem unidade_id resolvido:              1.284 (38%)
  com unidade_id resolvido:              2.077

profile do coordenador (piloto TI):
  profile_unidades: []           <- vazio
  profile_setores:  [TI/SMS]     <- acesso vem só daqui
```

A RLS de `importacao_rh_pendentes` (`20260812030000`) e o parâmetro de escopo das RPCs de
promover/atualizar (`fn_unidade_no_escopo`) só verificam `profile_unidades`. Um coordenador cujo
acesso vem inteiramente de `profile_setores` (setor vinculado, sem a unidade-pai vinculada
também) nunca bate em `unidade_id IN profile_unidades` — mesmo tendo acesso legítimo à unidade
pelo próprio setor. É o mesmo padrão que a policy de `servidores` (`20260618080000`) já resolve
certo (soma unidade-direta com setor-vinculado); `fn_unidade_no_escopo` nunca ganhou o lado do
setor.

Segundo problema, independente: mesmo corrigindo o primeiro, 1.284 pendências (38%) nunca
apareceriam para nenhum coordenador, porque `unidade_id IN (...)` nunca casa com `NULL` — a
importação original não conseguiu casar o departamento de origem com nenhuma unidade do
SisEscala, e nada persiste uma correção disso depois. Só admin/super_admin alcançam essas linhas
hoje.

## O que foi construído

Ver `CLAUDE.md` (seção "Fase 5" e a nota sobre `fn_unidade_no_escopo`) para o desenho completo.
Resumo, migration `20260812050000`:

1. **`fn_unidade_alcancavel_por_setor`** — complemento pontual de `fn_unidade_no_escopo`, usado
   só na RLS de `importacao_rh_pendentes` e nas duas RPCs (`fn_promover_pendencia_rh`,
   `fn_atualizar_cadastro_via_pendencia_rh`). `fn_unidade_no_escopo` em si não foi alterada — é
   usada por bastante coisa do módulo REP não auditada nesta sessão, e mudar o comportamento
   dela é risco maior do que o necessário para resolver isto.
2. **`fn_buscar_pendencia_rh_por_termo`** — busca cross-unidade por nome/matrícula/CPF, bounded
   (≥3 caracteres, ≤20 resultados), `SECURITY DEFINER` bypassando RLS de propósito (mesmo padrão
   de `get_external_servers_for_scale`/`fn_cpf_ja_cadastrado`). Nova seção "Não achou seu
   servidor? Busque em toda a base" em `/servidores/pendencias`.
3. **`fn_pendencia_rh_por_cpf`** — lookup pontual por CPF exato, para o cadastro/edição de
   servidor. Pedido do usuário: "o próprio sistema consultar" essa base ao criar ou editar um
   servidor, sem que ninguém precise saber que a tela de Pendências existe. Novo componente
   `PendenciaRhCpfBanner` (`src/components/servidores/`), usado em `/servidores/novo` e na ficha
   de edição — detecta o CPF, oferece puxar os dados complementares. A aplicação em si reusa
   `fn_atualizar_cadastro_via_pendencia_rh` (já existente, v1.51.0), que já só preenche campo
   vazio e já marca `promovido_em` — tirar da fila de pendências é garantido pela própria função
   que já existia, não precisou de lógica nova para isso.

## Decisão: não tocar `fn_unidade_no_escopo`

A correção mais "limpa" seria somar o lado do setor direto em `fn_unidade_no_escopo`, já que ela
é o helper canônico do projeto para essa pergunta. Não foi feito: essa função é usada por
`marcacoes_ponto`, `dispositivos_rep` e outras peças do módulo REP que não foram auditadas nesta
sessão, e o texto da pendência #3 da Fase 5 (CLAUDE.md) já descreve efeitos em cascata
específicos de somar essa checagem em `fn_blocos_previstos_dia`. Preferiu-se um complemento
pontual (`fn_unidade_alcancavel_por_setor`), usado só nos dois lugares desta feature, e deixar a
correção completa como pendência registrada para quando o módulo REP for revisitado.
