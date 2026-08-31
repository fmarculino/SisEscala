# Estratégia de canais: reduzir os bloqueios do WhatsApp (30/08/2026)

**Plano para decisão — nada implementado.**

> 🔄 **Revisado em 30/08/2026 depois de medir produção.** A primeira versão deste plano propunha
> "transformar o aviso por batida em resumo diário". **Estava errado**: os modos de resumo já
> existem desde `20260809140000`, e `resumo_diario` já é o padrão. O usuário estava certo. As
> seções abaixo refletem o que o sistema realmente faz.

---

## 1. O que foi medido em produção (30/08/2026)

| o quê | número |
|---|---|
| Servidores ativos | 1.403 |
| …com **telefone** | 870 (62%) |
| …com **e-mail** | **634 (45%)** |
| **Aviso de ponto ATIVADO** | **25** (975 inativos) |
| Modo escolhido | **999 `resumo_diario`**, 1 `resumo_semanal` |
| Acionamentos reais de sobreaviso | **5** |

Fila de avisos, por tipo e resultado:

| tipo | enviado | falha |
|---|---|---|
| `resumo_diario` | 232 | **73** |
| `registro` (por batida) | 85 | 7 |
| `confirmacao_optin` | 37 | 4 |
| `resumo_semanal` | 2 | 0 |

E um achado que muda a execução: **nenhum código chama o envio de e-mail.** `enviarEmailInterno`
tem zero chamadores fora da ação de teste. O SMTP está configurado (Gmail) e nunca foi usado — é
**construir**, não migrar.

---

## 2. O diagnóstico mudou depois de medir

🚨 **O bloqueio está acontecendo com 25 servidores ativos e ~440 mensagens no total.**

Isso é o dado mais importante do documento, e ele derruba a hipótese intuitiva. **Não é volume.**
Nesse patamar, nenhum limite de envio explicaria bloqueio — o que explica é a pesquisa:

> *"Se você usa ferramentas não oficiais, nenhum protocolo de aquecimento ou estratégia de
> template protege seu número — os sistemas da Meta detectam acesso não autorizado à API e
> encerram contas independentemente do conteúdo da mensagem."*

⚠️ **Consequência honesta: as medidas deste plano compram tempo e reduzem frequência. Elas não
eliminam o bloqueio,** porque a causa principal não é o que se envia — é por onde se envia.

O que ainda justifica fazê-las:

1. **Reduzir a superfície** enquanto a via oficial não é possível.
2. **Proteger o que não pode cair.** Hoje o aviso de ponto e o sobreaviso saem pelo mesmo número:
   cada bloqueio derruba os dois. E o sobreaviso é chamar alguém para uma emergência.
3. **Não deixar o problema crescer.** Com 25 ativos são 440 mensagens; com os 870 que têm telefone
   e modo diário, seriam **~870/dia**. O desenho atual escala para o bloqueio garantido.

---

## 3. Sobre a API oficial

ℹ️ **Decisão do usuário (30/08/2026): fora de cogitação por ora** — depende de licitação, que
demora e não tem previsão. Registrado aqui porque continua sendo a única solução que remove a
causa, e porque quando houver janela orçamentária a informação já está levantada:

- As mensagens do sistema se enquadram como **utility** (transacional), categoria que custa de
  **80% a 95% menos** que marketing.
- **Utility dentro da janela de 24 h é gratuita.**
- Desde julho/2026 já é possível faturar em **BRL**.
- Com o volume proposto (praticamente só sobreaviso), o custo tende a ser irrisório.

Enquanto isso, o resto deste plano é mitigação — e está dito que é.

---

## 4. O que JÁ EXISTE e não precisa ser construído

Levantado antes de propor qualquer coisa, para não reimplementar o que está pronto:

| peça | estado |
|---|---|
| Modos de granularidade (`todas`, `entrada_saida`, `resumo_diario`, `resumo_semanal`) | ✅ desde `20260809140000` |
| `resumo_diario` como padrão | ✅ (999 servidores) |
| `resumo_semanal` funcionando | ✅ (2 enviados, 0 falha) |
| **Confirmação de opt-in** (`confirmacao_optin`) | ✅ 37 enviadas — a ideia de "pedir confirmação antes" **já está implementada** |
| Fila com status e retentativa | ✅ `avisos_ponto_fila` |
| Troca de modo pelo Portal | ✅ `definirModoAvisoPonto` |
| Envio de e-mail | ⚠️ existe o motor, **zero chamadores** |

---

> 🔄 **Segunda correção (30/08/2026).** A tabela acima está desatualizada: a migration
> `20260814130000` **já removeu** os modos `todas` e `entrada_saida` e **já removeu** o aviso
> individual de `fora_janela`. Sobraram só `resumo_diario` e `resumo_semanal`.
>
> 🚨 **E o motivo dela importa mais que o conteúdo:** *"O número de WhatsApp usado pelo aviso de
> ponto foi restringido pela Meta por volume de mensagem."* **Isto já aconteceu antes, o volume
> já foi reduzido uma vez, e o bloqueio voltou** — com 25 servidores ativos. É a evidência mais
> forte de que a causa dominante é a API não oficial, não o volume.
>
> Consequência direta: minha recomendação anterior de "manter `fora_janela` avisando sempre"
> **está morta** — ele não existe mais desde 14/08.

---

## 5. As decisões tomadas (30/08/2026)

### ✅ A) Todos migram para `resumo_semanal`, e ele passa a ser o padrão

Os 999 servidores em `resumo_diario` estão nele **por omissão, não por escolha** — só 1 pessoa
escolheu algo diferente em todo o cadastro. Migrar todos e mudar o padrão dá **~7× menos
mensagens**; quem quiser diário troca no Portal, que já existe.

### ✅ B) E-mail é o canal PADRÃO; WhatsApp é a exceção

```
tem e-mail?  ── sim ──>  E-MAIL          (padrão; pode trocar para WhatsApp no Portal)
     │
     └─ não ──>  tem telefone?  ── sim ──>  WHATSAPP
                       │
                       └─ não ──>  sem canal: fica como pendência de cadastro
```

Tira **634 de 870** destinatários possíveis do canal que bloqueia, sem que ninguém deixe de ser
avisado. E o servidor pode **mudar explicitamente** para WhatsApp no Portal do Servidor.

⚠️ **Cada e-mail cadastrado é uma pessoa a menos no canal que bloqueia** — o cadastro vira alavanca
direta, não tarefa burocrática.

### ✅ C) Demais medidas (aceitas)

| medida | valor |
|---|---|
| Atraso aleatório entre envios de WhatsApp | **30–90 s**, com jitter |
| Janela de silêncio | **21h–06h** |
| Teto por hora / por dia | configurável; a fila **espera**, nunca descarta |
| Número que falha repetidamente | **sai da fila e vira pendência na tela** — insistir é o padrão que a plataforma pune |

---

## 6. O que será implementado

### Banco
1. `servidores.aviso_ponto_canal` — `email` \| `whatsapp`, **default `email`**.
2. `aviso_ponto_modo`: default passa a `resumo_semanal`; **UPDATE migrando os 999**.
3. `avisos_ponto_fila` ganha **`canal`** e **`destino`** (o e-mail ou o telefone resolvido no
   enfileiramento) — hoje só existe `telefone`.
4. Resolução do canal na hora de enfileirar: preferência do servidor → cai para o que existir.
5. `fn_definir_canal_aviso_ponto`, espelhando `fn_definir_modo_aviso_ponto`.
6. Teto/janela de silêncio em `configuracoes_globais`, respeitados por `fn_avisos_ponto_pendentes`.

### Backend
7. `enviarEmailInterno` ganha **o primeiro chamador real** no despacho, roteando por `canal`.
8. Atraso aleatório de 30–90 s **entre envios de WhatsApp** (e-mail não precisa).
9. Falha repetida encerra o item como pendência, em vez de retentar para sempre.

### Portal do Servidor
10. Escolha de **canal** (E-mail / WhatsApp), ao lado da escolha de modo que já existe.

---

## 7. O que NÃO será feito, e por quê

**Variar levemente o texto da mensagem.** É frágil, não ataca a causa — que a medição mostrou ser
a API, não o conteúdo — e tem custo próprio: **mensagem oficial de órgão público deveria ser
idêntica e reconhecível.** Texto que muda a cada envio é o que um golpista faz, e este sistema
envia PIN de acesso.

**Dois números separados** (um só para sobreaviso). Continua sendo boa ideia, mas depende de linha
e de conta nova — fica registrado como pendência operacional, não de código.

---

## 8. Expectativa honesta

⚠️ **Isto reduz a superfície; não elimina o bloqueio.** O número já foi restringido uma vez, o
volume já foi cortado uma vez, e voltou a acontecer com 25 servidores ativos. Enquanto a API for
não oficial, o risco permanece — e o que este plano garante é que, **quando o bloqueio vier, ele
alcance o aviso informativo e não o acionamento de sobreaviso**, porque a maior parte do tráfego
terá saído do WhatsApp.

A solução que remove a causa continua sendo a Cloud API oficial, hoje fora de alcance por
depender de licitação.
