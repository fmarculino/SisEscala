package rep

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"golang.org/x/text/encoding/charmap"
)

// DecodificarLatin1 converte os bytes crus do AFD (ISO-8859-1) para UTF-8. A conversão
// acontece uma única vez, aqui — o sha256 enviado ao SisEscala é sempre o dos BYTES
// ORIGINAIS (calculado por SHA256Hex sobre o parâmetro `bruto`, antes desta função), nunca do
// resultado, para preservar o artefato legal.
func DecodificarLatin1(bruto []byte) (string, error) {
	utf8, err := charmap.ISO8859_1.NewDecoder().Bytes(bruto)
	if err != nil {
		return "", err
	}
	return string(utf8), nil
}

// SHA256Hex calcula o sha256 dos bytes originais (antes da conversão de encoding).
func SHA256Hex(bruto []byte) string {
	soma := sha256.Sum256(bruto)
	return hex.EncodeToString(soma[:])
}

// DividirLinhas separa o AFD já decodificado em linhas não vazias, na ordem em que aparecem.
func DividirLinhas(afdUTF8 string) []string {
	brutas := strings.Split(strings.ReplaceAll(afdUTF8, "\r\n", "\n"), "\n")
	linhas := make([]string, 0, len(brutas))
	for _, l := range brutas {
		l = strings.TrimRight(l, "\r")
		if strings.TrimSpace(l) != "" {
			linhas = append(linhas, l)
		}
	}
	return linhas
}
