# Guard de escopo em fn_blocos_previstos_dia e limpeza de intervalo sintético (Fase 5) — 12/08/2026

## Contexto

Duas das três pendências que o CLAUDE.md listava como bloqueio para a Fase 5 do módulo REP
(sair do piloto da TI para as primeiras unidades reais). O usuário pediu para resolver as duas
depois de confirmar, com dados reais de produção, que o piloto ainda não está pronto para expandir.

## 1. Guard de escopo em `fn_blocos_previstos_dia`

`fn_blocos_previstos_dia` é `SECURITY DEFINER` com `GRANT EXECUTE` para `authenticated` desde
`20260808040000`, e nunca validou se quem chama tem acesso ao servidor consultado — só pedia
`p_servidor_id` e `p_data`. Qualquer usuário autenticado (coordenador, `rh_unidade`, etc.) podia
consultar a projeção de presença de qualquer servidor da base, de qualquer unidade, sabendo só o
UUID.

`fn_blocos_previstos_mes` (a que a grade chama de verdade), `fn_alocar_marcacoes_dia`,
`fn_projecao_marcacoes_dia` e `fn_conferir_reconciliacao` têm a mesma exposição, mas nenhuma
precisou de guard próprio: todas são, por construção, envelopes `LATERAL` sobre
`fn_blocos_previstos_dia` — `fn_blocos_previstos_mes` já documentava isso na própria migration
(`20260808120000`) como pendência deliberadamente adiada, "para não misturar mudança de segurança
com mudança de comportamento na mesma migration". Fechar na raiz fecha a cadeia inteira.

### Por escala, não por lotação

A tentação óbvia seria checar `servidores.unidade_id`/`setor_id` (a lotação atual). Errado: um
servidor externo adicionado à escala de outra unidade (v1.2.4, "Seleção de Servidor Externo")
tem que continuar visível para quem gerencia *aquela* escala, mesmo fora da própria lotação — é
exatamente esse o caso de uso da feature. A `escala_mensal` do servidor naquele mês/ano já carrega
o `unidade_id`/`setor_id` corretos para quem deveria poder ver, servidor externo ou não. O guard
checa por ela, via `EXISTS`, em vez de pela lotação — cobre os dois casos sem precisar distinguir.

`fn_unidade_no_escopo` sozinha não bastava — verifica só `profile_unidades`. Somada com
`fn_unidade_alcancavel_por_setor` (`20260812050000`, criada mais cedo no mesmo dia para a mesma
lacuna em `importacao_rh_pendentes`), cobre também quem só tem `profile_setores` vinculado, sem a
unidade-pai (o caso real do piloto da TI).

### Por que `service_role` bypassa

Não há, hoje, nenhum caller de aplicação para `fn_alocar_marcacoes_dia`, `fn_projecao_
marcacoes_dia`, `fn_conferir_reconciliacao` ou `fn_reconciliar_marcacoes_dia` — grep em `src/`
não acha nenhum. A cadeia de reconciliação só é chamada manualmente hoje, via SQL direto com a
service role key, o que roda sem sessão de usuário e portanto sem `auth.uid()`. Bloquear esse
caminho pararia a única forma de operar a reconciliação hoje. `fn_reconciliar_marcacoes_dia` já é
`service_role` apenas desde `20260808060000` — nada muda ali.

### Geração mecânica

Migration `20260812130000`, gerada por `scratchpad/gen_escopo_blocos.js` seguindo o mesmo padrão
já estabelecido (`gen_dobra.js`, `gen_elegibilidade.js`): copia o corpo vigente da função
(`20260809000000`, a versão que sobreviveu à ancoragem de plantão noturno), insere só o bloco do
guard logo após `v_ano` ser resolvido, e aborta se qualquer contagem de guard/marcador divergir.
Conferido por script (não visualmente): fora do trecho inserido, a função ficou **byte a byte
idêntica** à vigente.

## 2. Limpeza das marcações de intervalo sintéticas

O CLAUDE.md registrava "103 marcações de intervalo existem em unidades com
`permite_marca_intervalo = false` (...) a reconciliação as apagaria — decisão explícita
necessária, não pode ser efeito colateral". Antes de levar essa decisão ao usuário, reconferido
contra produção: o número real era **7**, não 103 — a nota estava desatualizada, provavelmente de
uma contagem anterior a alguma correção já aplicada.

As 7 linhas são todas da LACEM (única unidade do piloto sem `permite_marca_intervalo`), todas em
agosto/2026, e todas têm o padrão clássico de horário **sintético** (CLAUDE.md armadilha 5): os
campos de intervalo caem exatamente em `:00:00`, enquanto entrada/saída têm segundos reais de
batida de terminal. Artefato confirmado da regressão de `20260804080000` (perda do guard de
`fn_jornada_tem_intervalo` na validação manual, corrigida em `20260807050000`/`20260807080000`) —
não intervalo de verdade gozado pelo servidor.

Apresentadas três opções ao usuário (limpar agora / deixar a reconciliação decidir / manter como
está e blindar contra reconciliação futura); escolhida **limpar agora**. Migration `20260812140000`:
`UPDATE` por **id explícito** das 7 linhas (não por critério amplo como
`WHERE permite_marca_intervalo = false`, que pegaria qualquer coisa que passe a corresponder no
futuro) — só os dois campos de intervalo são zerados, entrada e saída reais preservadas.

## Verificação

- `npx tsc --noEmit` limpo (mudança é só SQL).
- Diff programático confirmou a função de `fn_blocos_previstos_dia` idêntica fora do guard
  inserido.
- **Migrations aplicadas e confirmadas em produção em 12/08/2026** (via PostgREST, service role
  key, mesma técnica de leitura já usada nesta sessão):
  1. As 7 linhas da LACEM ficaram com `presenca_intervalo_saida_em`/`presenca_intervalo_retorno_em`
     `NULL`; entrada/saída reais intactas.
  2. Busca ampla sobre todas as unidades sem `permite_marca_intervalo`: zero marcações de
     intervalo remanescentes.
  3. `fn_blocos_previstos_dia` chamada via service role para um servidor real continuou
     respondendo normalmente — sem regressão no caminho legítimo (bypass funcionando).
  - **Não verificado nesta sessão**: o caminho negativo do guard (um coordenador autenticado
    tentando consultar um servidor fora do próprio escopo) — service role sempre bypassa por
    desenho, então só é testável com uma sessão de usuário real no navegador.
