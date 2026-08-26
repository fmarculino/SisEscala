# Auto-atualização do coletor — revertendo uma decisão que a premissa derrubou

**26/08/2026.** Coletor **v0.12.0**.

---

## 1. O número que decidiu a questão

O "avisa e espera clique, nunca automático" está registrado no `CLAUDE.md` como **decisão
explícita do usuário**, com a mesma cautela do Smart App Control. Ela foi tomada quando o parque
tinha 1 ou 2 relógios e havia alguém por perto. Estado medido hoje, com **15 relógios**:

```
0.11.2  ->  4 relógios      (versão atual)
0.10.0  ->  1
0.8.0   ->  9
0.7.0   ->  1  (CEI)
```

**11 de 15 desatualizados — e todos os 11 vivos**, com último contato entre 0,1h e 7,1h. O
gargalo nunca foi rede nem máquina desligada: era o clique que ninguém dava.

⚠️ **Agrava:** a **v0.9.0** foi quem trocou a fila offline plana pela fila por dispositivo. Em
v0.8.0, duas instâncias na mesma máquina dividem `%PROGRAMDATA%\SisEscala\fila` e o lote de um
relógio pode ser reenviado com o **token do outro** — AFD atribuído ao equipamento errado, sem
erro em lugar nenhum. **9 relógios** estavam nessa versão. Ficar para trás aqui não é defasagem
cosmética.

---

## 2. A máquina já existia

Nada precisou ser construído do zero — o que separava "espera clique" de "aplica sozinho" era
**quem chama `aplicarAtualizacao()`**, e só o `case itemAtualizar.ClickedCh` chamava.

| peça | estado antes |
|---|---|
| `ciclo.VersaoDisponivel` | pronta, pública, sem HMAC |
| `ciclo.BaixarNovaVersao` | pronta, **confere sha256** e descarta download corrompido |
| `aplicarAtualizacao` (rename do `.exe` em execução + relançar) | pronta |
| espera de 3s pelo mutex do processo novo | pronta |

---

## 3. O que mudou, e por quê cada parte

### 3.1 O interruptor fica no SERVIDOR

Trocar *espera clique* por *aplica sempre* trocaria um problema por um pior: um release ruim
alcançaria o parque inteiro em até 24h, nas máquinas que são justamente as que não se alcança
fisicamente. **Defasagem é chato; parque inteiro derrubado é uma viagem a cada unidade.**

`GET /api/coletor-rep/tray-version` passou a devolver a **política**, não só a versão:

```json
{"versao":"0.12.0","sha256":"...","auto_update":true,"atraso_max_minutos":240}
```

Vem de `configuracoes_globais` (`coletor_auto_update`, `coletor_auto_update_atraso_max_minutos`,
seed em `20260826230000`). Parar uma versão ruim é trocar uma linha — sem deploy e sem tocar em
nenhuma máquina.

- **Chave ausente = ligado** (é o padrão do produto).
- **Falha ao ler = desligado.** Sem conseguir ler a política, o certo é não mandar o parque trocar
  de binário.
- Campo ausente na resposta (servidor anterior à v0.12.0) desserializa como `false` em Go — o
  coletor volta a só avisar, que é o comportamento seguro quando não se sabe a política.

### 3.2 Atraso sorteado

Até `atraso_max_minutos` (padrão 240), sorteado no cliente na primeira vez que vê a versão. Com 15
relógios, uma falha aparece nas primeiras máquinas antes de alcançar as demais. Não precisou de
estado novo no servidor nem quebrou o desenho sem-HMAC da rota.

O agendamento vive **só em memória**: se o app reiniciar, sorteia de novo. Persistir criaria mais
um arquivo de estado para dessincronizar com o `config.yaml`.

### 3.3 Rollback de verdade

`aplicarAtualizacao` já esperava 3s pelo processo novo assumir o mutex — sintoma típico de Smart
App Control/Defender bloqueando `.exe` recém-escrito, já documentado neste projeto. Mas na falha
ela **mantinha o `.exe` novo instalado** e seguia rodando a instância antiga.

⚠️ Isso era um caso isolado enquanto atualizar era um clique. Com auto-update passaria a valer
para o parque inteiro: no próximo boot o autostart lançaria justamente o executável bloqueado e a
unidade sairia do ar **em silêncio**. Agora a falha **restaura o binário anterior** (remove o novo,
renomeia o `.antigo` de volta), então o autostart continua válido.

### 3.4 Nunca no meio de um ciclo

A auto-aplicação roda no **fim de `executarCiclo`, na mesma goroutine** — trocar o `.exe` com um
lote em voo perderia o ciclo. A fila offline é em disco (`fila\<dispositivo_id>\`), então lote
pendente sobrevive à troca.

---

## 4. Runbook: parar uma versão ruim

```sql
UPDATE public.configuracoes_globais
   SET valor = to_jsonb('false'::text)
 WHERE chave = 'coletor_auto_update';
```

No próximo ciclo de cada máquina (5 min) o coletor volta a só avisar.

⚠️ **As que já atualizaram continuam na versão nova.** Reverter *essas* exige publicar um `dist/`
anterior com `VERSION` maior, porque `compararVersoes` só aceita subir. É por isso que o atraso
sorteado importa: ele é o que garante que nem todas terão atualizado quando o problema aparecer.

---

## 5. O que não mudou

- O **sha256** continua conferido antes de instalar — inegociável.
- A checagem continua **no máximo 1x/dia**, não a cada ciclo de 5 min.
- `higiene-remover`, `cadastros` e `biometria` continuam **fora** do ciclo automático. Auto-update
  troca o binário; escrever em equipamento de produção continua exigindo decisão humana.
