# Escopo e elegibilidade do aviso de ponto — 3 problemas e a solução

**Data:** 09/08/2026
**Origem:** três problemas levantados pelo usuário ao revisar a tela de configuração.
**Depende de:** [2026-08-09-comprovante-de-ponto-por-whatsapp.md](2026-08-09-comprovante-de-ponto-por-whatsapp.md)
**Estado:** proposto — **nada implementado ainda**.

---

## O que existe hoje

Três chaves precisam concordar para uma mensagem sair:

| # | chave | onde | quem decide |
|---|---|---|---|
| 1 | `unidades.aviso_ponto_whatsapp` | unidade | coordenação |
| 2 | `setores.aviso_ponto_whatsapp` (`NULL` herda) | setor | coordenação |
| 3 | `servidores.aviso_ponto_status` | pessoa | **o próprio servidor**, com double opt-in |

A resolução de 1 e 2 vive em `fn_aviso_ponto_habilitado(unidade_id, setor_id)`:

```sql
COALESCE(setor.aviso_ponto_whatsapp, unidade.aviso_ponto_whatsapp, false)
```

---

## Problema 1 — A hierarquia unidade ↔ setor não é evidente

**O que acontece:** o setor **sobrepõe** a unidade. Setor `true` + unidade `false` → habilitado.
Unidade `true` propaga para todo setor em `NULL`.

| unidade | setor | resultado |
|---|---|---|
| `false` | `NULL` (herda) | ❌ desabilitado |
| `false` | `true` | ✅ **habilitado** — é isto que viabiliza o piloto |
| `true` | `NULL` (herda) | ✅ habilitado |
| `true` | `false` | ❌ desabilitado |

**Isso é defeito?** A *semântica* não — é ela que permite ligar a TI (6 servidores) sem ligar a SMS
(78). Exigir a unidade ligada para ligar o setor desfaria a razão de a feature existir.

**O defeito é de visibilidade:** a tela da unidade não diz que setores podem sobrepô-la. Quem
desmarca a unidade acredita ter desligado tudo.

### Solução 1

Manter a precedência. Na tela da **unidade**, listar quem a sobrepõe:

> ⚠️ 2 setores desta unidade têm configuração própria e **não seguem** esta chave:
> TECNOLOGIA DA INFORMAÇÃO (habilitado), PORTARIA (desabilitado).

Sem isso, "desliguei a unidade" continuará sendo lido como "desliguei tudo".

---

## Problema 2 — Servidor de lotação não habilitada consegue ativar 🔴

**É um furo real, e o mais grave dos três.**

`fn_solicitar_aviso_ponto` valida termo, servidor, telefone e pedido pendente — e **nunca consulta
`fn_aviso_ponto_habilitado`**. Consequência:

1. servidor de setor **desabilitado** abre o Portal e clica em *Ativar*;
2. o sistema **envia a mensagem de confirmação pelo WhatsApp**;
3. ele responde `SIM` e fica `ativo`;
4. nenhuma mensagem de ponto chega — o gatilho barra corretamente.

O dano não é o passo 4, é o **passo 2**: sai mensagem por uma lotação que a coordenação não
liberou, **no mesmo número que serve o acionamento de sobreaviso**. Durante o piloto da TI,
qualquer pessoa da CAF, DMAC ou ALMOXARIFADO que achar a aba fura o portão de rollout.

### Solução 2

`fn_solicitar_aviso_ponto` recusa quando `fn_aviso_ponto_habilitado(unidade, setor)` for falso:

> *"O aviso de ponto ainda não está disponível na sua lotação. Fale com seu coordenador."*

E o botão **Ativar aviso** nasce desabilitado no Portal, com a explicação — em vez de deixar clicar
e falhar depois de já ter mandado mensagem.

⚠️ **Duas exceções que não podem ser esquecidas:**

- **Desativar continua sempre permitido.** Quem está ativo e depois sai do escopo precisa poder
  sair. Amarrar a saída à habilitação prenderia a pessoa numa preferência que ela não pode mudar.
- **`PARAR` pelo WhatsApp continua honrado incondicionalmente.** É a defesa contra denúncia e
  banimento; não pode depender de configuração nenhuma.

---

## Problema 3 — Transferência para lotação não habilitada

**O que acontece hoje:** o gatilho resolve a habilitação **no instante da batida**, lendo
`unidade_id`/`setor_id` da própria marcação. Servidor transferido para setor desabilitado
**não recebe nada** — não há risco de mensagem indevida. E o Portal já mostra a faixa âmbar
avisando que o envio não está habilitado na lotação.

**O defeito é de dado, não de comportamento:** `aviso_ponto_status` continua `'ativo'`, então

```sql
SELECT count(*) FROM servidores WHERE aviso_ponto_status = 'ativo'   -- responde errado
```

conta gente que não recebe nada. Numa auditoria de consentimento — que é o que
`logs_preferencia_aviso_ponto` existe para sustentar — isso é resposta falsa.

### Por que **não** desativar na transferência

**Consentimento é sobre a pessoa e o canal; lotação é sobre disponibilidade.** Ele consentiu em
receber no WhatsApp dele. Ser transferido não é ele retirar consentimento — e gravar a desativação
registraria como decisão dele algo que foi ato administrativo, no mesmo log que serve de prova.

Custo prático: voltando ao setor original, ele refaz o double opt-in inteiro — **incluindo mais uma
mensagem de confirmação**, no número que estamos protegendo. Transferência entre setores da mesma
unidade não é rara.

### Solução 3 — separar **consentimento** de **efetividade**

| conceito | onde | significa |
|---|---|---|
| consentimento | `servidores.aviso_ponto_status` | o que a pessoa decidiu — **não muda por transferência** |
| efetividade | `fn_aviso_ponto_efetivo(servidor_id)` | consentiu **E** a lotação atual está habilitada |

- `fn_aviso_ponto_efetivo` = `aviso_ponto_status = 'ativo' AND fn_aviso_ponto_habilitado(...)`.
  É o que qualquer relatório de "quem recebe" passa a consultar.
- No Portal, o rótulo vira **`Ativado — indisponível na sua lotação atual`** quando for o caso,
  em vez de um `Ativado` que não se cumpre.

Resultado: nada é enviado indevidamente (já garantido), nenhuma consulta mente, o consentimento não
é apagado por ato administrativo, e voltar ao setor original não custa mensagem nova.

**Alternativa, se a preferência for desativar mesmo:** gravar com `origem = 'sistema'` e ação
própria `suspenso_por_transferencia` — **nunca** `desativou`, que atribuiria à pessoa uma decisão
que não foi dela. Exige `CHECK` novo em `logs_preferencia_aviso_ponto.acao`.

---

## Resumo executivo

| # | problema | gravidade | solução |
|---|---|---|---|
| 1 | hierarquia não é evidente na tela da unidade | baixa — semântica está certa | listar os setores que sobrepõem |
| 2 | **opt-in sem habilitação envia WhatsApp** | 🔴 **alta** — fura o portão do piloto | `fn_solicitar_aviso_ponto` recusa; botão desabilitado |
| 3 | status `ativo` não reflete a realidade após transferência | média — dado, não comportamento | `fn_aviso_ponto_efetivo`, sem apagar consentimento |

**O 2 deve sair antes de ligar a TI** — é durante o piloto que o furo importa. O 1 e o 3 podem
acompanhar.

Migration prevista: `20260809170000`, mais ajustes no Portal e na tela da unidade.

## O que NÃO muda

- A precedência `setor → unidade → false` (é ela que viabiliza o piloto por setor).
- O gatilho continua resolvendo a habilitação **no instante da batida**, pela lotação da marcação —
  o que já garante que transferência não gera envio indevido.
- `PARAR` e desativar continuam incondicionais.
