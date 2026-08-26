// Package config lê o config.yaml do coletor. Cada máquina pode ter só a seção
// dispositivo_rep/dispositivos_rep, só terminal_local, ou as duas — são independentes de
// propósito, porque o mesmo binário atende os dois cenários da topologia mista descrita no plano.
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type SisEscalaConfig struct {
	URL string `yaml:"url"`
}

// DispositivoRepConfig é um relógio de ponto físico (REP-C). Uma unidade pode ter VÁRIOS
// (medido: unidades com 4 equipamentos), e desde a v0.9.0 todos cabem no mesmo coletor —
// ver o comentário de Config.Dispositivos.
type DispositivoRepConfig struct {
	// Nome e' so' rotulo de log/menu ("REP-iDClass-HMI-01"). Nao identifica nada no servidor:
	// quem faz isso e' o ID, que e' o uuid de dispositivos_rep. Ausente cai para o endereco.
	Nome            string `yaml:"nome"`
	ID              string `yaml:"id"`
	Token           string `yaml:"token"`
	Endereco        string `yaml:"endereco"`
	Porta           int    `yaml:"porta"`
	UsaHTTPS        bool   `yaml:"usa_https"`
	UsuarioRep      string `yaml:"usuario_rep"`
	SenhaRep        string `yaml:"senha_rep"`
	CertFingerprint string `yaml:"cert_fingerprint"`

	// TimeoutAfdSegundos e' quanto esperar por get_afd.fcgi especificamente — nao pelas outras
	// chamadas, que sao pequenas e devem falhar rapido quando o relogio esta fora do ar. Zero ou
	// ausente usa o padrao de rep.NovoClient. Existe como config (e nao como constante) porque a
	// unica variavel aqui e' quao lento o equipamento monta o arquivo, e descobrir isso exige
	// estar na unidade — sem esta chave, ajustar significaria recompilar e redistribuir o .exe.
	TimeoutAfdSegundos int `yaml:"timeout_afd_segundos"`
}

// Rotulo e' como este relogio aparece em log e no menu da bandeja. Com varios equipamentos na
// mesma maquina, "sync concluido" sem dizer QUAL relogio nao diagnostica nada.
func (d *DispositivoRepConfig) Rotulo() string {
	if d == nil {
		return "(nenhum)"
	}
	if d.Nome != "" {
		return d.Nome
	}
	if d.Endereco != "" {
		return d.Endereco
	}
	return d.ID
}

// TerminalLocalConfig é a tela de presença local. Omitir esta seção desativa `terminal abrir`.
type TerminalLocalConfig struct {
	ID    string `yaml:"id"`
	Token string `yaml:"token"`
}

type FilaConfig struct {
	Diretorio string `yaml:"diretorio"`
}

type Config struct {
	SisEscala SisEscalaConfig `yaml:"sisescala"`

	// DispositivoRep e' a forma ANTIGA (um relogio por maquina) e continua valendo: todo
	// config.yaml ja instalado em campo usa ela. Nao remover.
	DispositivoRep *DispositivoRepConfig `yaml:"dispositivo_rep"`
	// DispositivosRep e' a forma nova, para a unidade com mais de um equipamento. As duas
	// convivem no mesmo arquivo; Dispositivos() junta.
	DispositivosRep []DispositivoRepConfig `yaml:"dispositivos_rep"`

	TerminalLocal *TerminalLocalConfig `yaml:"terminal_local"`
	Fila          FilaConfig           `yaml:"fila"`
}

// Dispositivos devolve todos os relógios que esta máquina coleta, na ordem em que devem ser
// percorridos (o singular legado primeiro).
//
// ⚠️ O ID tem que ser único na lista. Dois relógios com o mesmo id/token fariam o AFD de um
// entrar no SisEscala como sendo do outro — NSR de equipamentos diferentes misturados na mesma
// linha de dispositivos_rep, que é exatamente o estrago silencioso que a fila por dispositivo
// (package fila) existe para impedir. Carregar recusa o arquivo nesse caso.
func (c *Config) Dispositivos() []*DispositivoRepConfig {
	var todos []*DispositivoRepConfig
	if c.DispositivoRep != nil {
		todos = append(todos, c.DispositivoRep)
	}
	for i := range c.DispositivosRep {
		todos = append(todos, &c.DispositivosRep[i])
	}
	return todos
}

// Dispositivo acha um relógio pelo id, nome ou endereço — é o que o `--dispositivo` da CLI usa
// para mirar um equipamento só numa máquina que coleta vários.
func (c *Config) Dispositivo(referencia string) (*DispositivoRepConfig, error) {
	todos := c.Dispositivos()
	if len(todos) == 0 {
		return nil, fmt.Errorf("nenhum relogio configurado (secoes dispositivo_rep/dispositivos_rep ausentes no config.yaml)")
	}
	if referencia == "" {
		if len(todos) == 1 {
			return todos[0], nil
		}
		return nil, fmt.Errorf("esta maquina coleta %d relogios (%s) — informe --dispositivo <nome|ip|id>",
			len(todos), rotulos(todos))
	}
	var achados []*DispositivoRepConfig
	for _, d := range todos {
		if d.ID == referencia || d.Nome == referencia || d.Endereco == referencia {
			achados = append(achados, d)
		}
	}
	if len(achados) == 0 {
		return nil, fmt.Errorf("nenhum relogio com id/nome/endereco %q no config.yaml (configurados: %s)",
			referencia, rotulos(todos))
	}
	if len(achados) > 1 {
		return nil, fmt.Errorf("%q casa com mais de um relogio do config.yaml — use o id", referencia)
	}
	return achados[0], nil
}

func rotulos(todos []*DispositivoRepConfig) string {
	texto := ""
	for i, d := range todos {
		if i > 0 {
			texto += ", "
		}
		texto += d.Rotulo()
	}
	return texto
}

// Mesclar junta o config.yaml que ACABOU de ser baixado com o que já estava instalado na
// máquina, e é o que permite instalar o pacote do relógio e o do terminal em qualquer ordem.
//
// ⚠️ O que torna isto delicado desde a v0.9.0: existem DUAS formas de declarar relógio
// (`dispositivo_rep` singular, legado, e `dispositivos_rep` lista), e o mesmo equipamento pode
// aparecer nas duas. A mesclagem ingênua (preservar o singular sempre que o novo não o traz)
// produzia justamente isso ao instalar o "pacote da unidade" por cima de uma instalação antiga:
// o relógio 1 ficava na lista COM O TOKEN NOVO e no singular COM O TOKEN VELHO, id repetido,
// e `Carregar` recusa o arquivo inteiro — o app de bandeja nem abre.
//
// Duas regras, nesta ordem:
//
//  1. **Nunca perder um relógio.** Tudo que estava instalado e não veio no download continua —
//     senão baixar o pacote de UM relógio numa máquina que atende quatro apagaria os outros três,
//     e a unidade pararia de coletar sem ninguém notar.
//  2. **Quem repete, o novo ganha.** O download acabou de gerar o token; o que está em disco é o
//     token anterior, já invalidado pelo servidor. Manter o antigo seria preservar credencial
//     morta.
func Mesclar(existente, novo *Config) *Config {
	mesclado := *novo

	if novo.TerminalLocal == nil && existente.TerminalLocal != nil {
		mesclado.TerminalLocal = existente.TerminalLocal
	}

	// Ids que o download novo ja traz — em qualquer uma das duas formas.
	novos := map[string]bool{}
	if novo.DispositivoRep != nil {
		novos[novo.DispositivoRep.ID] = true
	}
	for _, d := range novo.DispositivosRep {
		novos[d.ID] = true
	}

	// O singular antigo so sobrevive se o novo nao tiver falado daquele relogio de forma nenhuma.
	// Quando sobrevive e o novo ja usa a forma de lista, ele ENTRA NA LISTA em vez de continuar
	// numa chave a parte: duas formas descrevendo o mesmo parque e o que confunde na proxima vez.
	if existente.DispositivoRep != nil && !novos[existente.DispositivoRep.ID] {
		if mesclado.DispositivoRep == nil && len(mesclado.DispositivosRep) == 0 {
			copia := *existente.DispositivoRep
			mesclado.DispositivoRep = &copia
		} else {
			mesclado.DispositivosRep = append(mesclado.DispositivosRep, *existente.DispositivoRep)
		}
		novos[existente.DispositivoRep.ID] = true
	}

	for _, d := range existente.DispositivosRep {
		if novos[d.ID] {
			continue
		}
		mesclado.DispositivosRep = append(mesclado.DispositivosRep, d)
		novos[d.ID] = true
	}

	return &mesclado
}

func Carregar(caminho string) (*Config, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(dados, &cfg); err != nil {
		return nil, err
	}

	if cfg.Fila.Diretorio == "" {
		programData := os.Getenv("PROGRAMDATA")
		if programData == "" {
			programData = "."
		}
		cfg.Fila.Diretorio = filepath.Join(programData, "SisEscala", "fila")
	}

	// Recusar o arquivo inteiro e' deliberado: um id repetido ou vazio nao produz erro visivel em
	// campo, produz batida atribuida ao equipamento errado meses depois.
	vistos := map[string]string{}
	for _, d := range cfg.Dispositivos() {
		if d.ID == "" {
			return nil, fmt.Errorf("relogio %q sem `id` no config.yaml", d.Rotulo())
		}
		if anterior, repetido := vistos[d.ID]; repetido {
			return nil, fmt.Errorf("id de dispositivo %s repetido no config.yaml (%s e %s) — "+
				"cada relogio tem id e token proprios", d.ID, anterior, d.Rotulo())
		}
		vistos[d.ID] = d.Rotulo()
	}

	return &cfg, nil
}
