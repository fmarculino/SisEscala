# Auditoria de segurança e conformidade com a LGPD

**Planejado em 23/08/2026 · execução prevista para a semana de 24–28/08/2026 · NÃO INICIADA.**

Motivação (usuário, 23/08/2026): o sistema está escalando rápido, guarda muita informação pessoal
e roda num **órgão público**. Antes de crescer mais, saber onde estão as brechas.

---

## 0. Por que isto não é uma auditoria genérica

O SisEscala trata **dado pessoal sensível** no sentido do Art. 11 da LGPD, não só dado cadastral:

| dado | onde | classificação |
|---|---|---|
| CPF, PIS/PASEP, matrícula, nome, e-mail, cargo, lotação | `servidores`, `profiles`, `auth.users` | pessoal |
| **jornada e frequência** (batidas, faltas, atrasos) | `marcacoes_ponto`, `escala_diaria`, `folha_ponto`, `rep_afd_registros` | pessoal — e prova em litígio trabalhista |
| **afastamentos e atestados** | `servidores_eventos`, `justificativas_eventos` + anexos | **SENSÍVEL — saúde (Art. 11)** |
| **localização (GPS)** | `logs_sobreaviso` (chegada ao destino) | pessoal, de alta sensibilidade prática |
| **biometria** | *template no equipamento*, `rep_vinculos_servidor.tem_biometria` no banco | **SENSÍVEL (Art. 11)** |
| PIN de acesso | `servidores.pin_acesso` (bcrypt) | credencial |

⚠️ **A biometria é o ponto que mais confunde e precisa ficar escrito:** o template **não** está no
banco do SisEscala — ele vive no relógio REP-C. O que o banco guarda é o *fato* de existir
biometria e o identificador (CPF ou PIS). Isso **reduz** o risco, mas não o elimina: o
equipamento é um controlador físico de dado biométrico sob responsabilidade do município, e a
auditoria precisa cobrir quem tem acesso administrativo a ele.

⚠️ **O `rep_afd_registros` é imutável por desenho** (cadeia de hash, valor legal de prova). Isso
colide de frente com o direito de eliminação (Art. 18, VI). A saída jurídica existe — Art. 16, I:
conservação para cumprimento de obrigação legal — mas **precisa estar documentada**, não presumida.

---

## 1. Fases, na ordem em que devem rodar

### Fase 0 — Inventário: o que existe, onde, por quanto tempo

Sem isto nenhuma das outras fases tem critério. Produz **um mapa** `tabela → dado pessoal → base
legal → retenção → quem acessa`.

Como medir:
- listar todas as tabelas de `public` e marcar as que têm dado pessoal;
- para cada uma, a **base legal** do Art. 7º/11 (para servidor público, tipicamente Art. 7º, II —
  obrigação legal; e Art. 11, II, "a" — cumprimento de obrigação legal para dado sensível);
- o **prazo de retenção** e o que acontece depois (a Portaria 671/2021 exige guarda do AFD; a
  legislação de arquivo do município define o resto).

**Entregável:** `docs/lgpd/inventario-de-dados.md` — é a base do Registro de Operações (Art. 37),
que o órgão é **obrigado** a manter.

### Fase 1 — Superfície de acesso: RLS, RPC, server action, rota

O sistema tem **quatro** portas para o mesmo dado, e a sessão de 22–23/08/2026 mostrou que elas
divergem entre si. Cada uma precisa ser varrida por conta própria:

| porta | o que checar | precedente desta base |
|---|---|---|
| **RLS** | toda tabela com dado pessoal tem RLS ligada? A policy cita **todos** os papéis? | `escala_mensal`/`escala_diaria`/`folha_ponto` ficaram sem `rh` por 2 meses (`20260812070000`) |
| **RPC** | toda função `GRANT`ada a `authenticated` tem guard de escopo **dentro** dela? | `fn_aceitar_marcacao_pendente` aceitava qualquer par (marcação, escala) — armadilha 12 |
| **server action** | cada uma autoriza sozinha, ou depende do `if` da página? | as 5 actions de `/usuarios` não conferiam papel nenhum (22/08/2026) |
| **rota de API** | qual segredo protege, e ela está fora do redirect do middleware? | `/api/cron` tinha fallback embutido num repo público (armadilha 18) |

⚠️ **Server action é um POST cujo id sai no bundle.** "A tela não mostra o botão" não é controle de
acesso. Esse foi o achado mais grave de 22/08/2026 e é o padrão a procurar em toda a base.

⚠️ **Revisar a rota que criei em 23/08/2026** (`/api/folha-ponto/regerar-competencia`): ela aceita
`SUPABASE_SERVICE_ROLE_KEY` como credencial. O raciocínio foi que quem tem essa chave já escreve
direto no PostgREST — mas isso amplia a superfície e deve ser reavaliado com cabeça fria.

Como medir (mecânico, na linha do que o projeto já faz):
```bash
# tabelas sem RLS
# policies que citam papel: procurar as que NÃO listam todos os papéis vigentes
grep -rn "= ANY(ARRAY\['admin'::user_role" supabase/migrations/
# RPCs GRANTadas a authenticated
grep -rn "GRANT EXECUTE ON FUNCTION.*authenticated" supabase/migrations/
# server actions sem checagem de papel
grep -rln "'use server'" src/ | xargs grep -Ln "getUserProfile\|hasSectorAccess\|role"
```

### Fase 2 — Autenticação e sessão

- **Portal do servidor autentica só por PIN** (matrícula + PIN). Qual a política de PIN? Há
  bloqueio após N tentativas? `logs_tentativas_presenca` mostra **378 de 911** tentativas com
  "Matrícula ou PIN inválidos" — quanto disso é erro de digitação e quanto é varredura?
- **Cookie do terminal local dura 180 dias.** A revogação real é `terminais_locais.ativo`, checada
  a cada marcação — confirmar que continua valendo e que a tela de gestão é usada.
- **`/presenca` clássico ainda usa sessão de coordenador no navegador do terminal.** Foi a causa
  relatada de alterações indevidas, e o terminal local existe para substituí-lo — mas a migração é
  unidade a unidade. **Medir quantas unidades ainda dependem dele.**
- Política de senha, MFA para `super_admin`/`rh`, e o que acontece quando um servidor é desligado.

### Fase 3 — Segredos e o repositório público

🚨 `github.com/fmarculino/SisEscala` é **público, com fork**. Já houve um vazamento real
(service_role de homologação, `0f525c9`, detectado pelo GitGuardian em 21/08/2026).

- varrer **todo o histórico** de novo (`git log --all -p`) atrás de JWT, senha, token, chave;
- conferir que **nenhuma** variável tem fallback embutido (o padrão certo é falhar com 500, como
  `TERMINAL_LOCAL_SESSION_SECRET`);
- inventariar os segredos em uso no Coolify e **rotacionar** o que estiver sem dono claro;
- decidir, explicitamente, se o repositório **continua público** — é uma escolha legítima, mas
  precisa ser uma decisão registrada e não um hábito.

### Fase 4 — Direitos do titular e obrigações documentais

O que a LGPD exige de um órgão público e o SisEscala hoje **não tem**:

| exigência | artigo | situação |
|---|---|---|
| Registro das operações de tratamento | 37 | não existe |
| Relatório de Impacto (RIPD) | 38 | não existe — e há dado sensível, o que o torna esperado |
| Encarregado (DPO) indicado e publicado | 41 | verificar se o município já tem, e se cobre este sistema |
| Atendimento ao titular (acesso, correção, portabilidade) | 18 | o Portal do Servidor já dá **acesso**; falta o resto |
| Eliminação após o fim do tratamento | 16 | não há política de retenção |
| Comunicação de incidente à ANPD | 48 | não há procedimento |

⚠️ **O Portal do Servidor já é meio caminho para o Art. 18.** Ele mostra escala e folha ao próprio
titular. Formalizar isso como canal de exercício de direitos é barato e vale muito.

### Fase 5 — Retenção, eliminação e o que fazer com dado alheio

Caso concreto que já existe e precisa de decisão: **relógios reaproveitados trouxeram ~250 mil
marcações da SMS e mais 9.626 já atribuídas de 2019–2025** (armadilha 20). São dados de pessoas
que podem nem ser mais servidores, tratados por um sistema que não as contratou.

`ponto_valido_desde` impede que virem ponto, mas **elas continuam armazenadas**. Isso precisa de
posição: base legal para manter, ou plano de eliminação.

---

## 2. Como executar sem quebrar o que está de pé

⚠️ **Auditoria é leitura.** Nenhuma fase acima escreve em produção. Achado vira item de plano, não
correção no ato — pelo mesmo motivo que esta base já adota: medir antes de decidir.

⚠️ **Peça autorização antes de tocar em produção, mesmo para leitura** (armadilha 3). E ao
documentar um achado, **descreva o que era, nunca qual era** — foi o que quase se errou ao
escrever a armadilha 18.

Ordem sugerida, por dependência e não por gravidade:

1. **Fase 0** (inventário) — sem ela as outras não têm critério.
2. **Fase 1** (superfície) — é onde estão os achados acionáveis e o histórico já provou que há.
3. **Fase 3** (segredos) — barata e de risco alto.
4. **Fase 2** (autenticação).
5. **Fases 4 e 5** (documental e retenção) — dependem do inventário e envolvem decisão jurídica do
   município, não só técnica.

## 3. O que NÃO tentar resolver nesta auditoria

- **Reescrever a RLS inteira.** O modelo de escopo tem duas formas coexistindo
  (`applyAccessFilters` e a RLS) e isso é dívida conhecida; a auditoria mapeia, não refatora.
- **Apagar dado histórico** sem decisão jurídica registrada.
- **Fechar o repositório** por reflexo — é decisão do usuário, com consequências para o fork.

## 4. Estimativa

Fases 0, 1 e 3 são as que cabem numa rodada e produzem o maior retorno. As 2, 4 e 5 dependem de
decisão externa (jurídico do município, DPO) e devem ser abertas como itens próprios.
