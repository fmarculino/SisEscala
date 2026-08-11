// Package config lê o config.yaml do coletor. Cada máquina pode ter só a seção
// dispositivo_rep, só terminal_local, ou as duas — são independentes de propósito, porque
// o mesmo binário atende os dois cenários da topologia mista descrita no plano.
package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type SisEscalaConfig struct {
	URL string `yaml:"url"`
}

// DispositivoRepConfig é o relógio de ponto físico (REP-C). Omitir esta seção no YAML deixa
// o campo nil e desativa os subcomandos sync/heartbeat.
type DispositivoRepConfig struct {
	ID              string `yaml:"id"`
	Token           string `yaml:"token"`
	Endereco        string `yaml:"endereco"`
	Porta           int    `yaml:"porta"`
	UsaHTTPS        bool   `yaml:"usa_https"`
	UsuarioRep      string `yaml:"usuario_rep"`
	SenhaRep        string `yaml:"senha_rep"`
	CertFingerprint string `yaml:"cert_fingerprint"`
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
	SisEscala      SisEscalaConfig       `yaml:"sisescala"`
	DispositivoRep *DispositivoRepConfig `yaml:"dispositivo_rep"`
	TerminalLocal  *TerminalLocalConfig  `yaml:"terminal_local"`
	Fila           FilaConfig            `yaml:"fila"`
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

	return &cfg, nil
}
