# Como falar com o bot (Telegram/WhatsApp)

## 1) Criar contrato de forma natural

Sempre informe:
- Nome do devedor
- CPF
- Valor principal
- Taxa ou total a pagar
- Quantidade de parcelas

Exemplos:

```text
criar contrato para João Silva, CPF 529.982.247-25, R$ 5.000, 3% ao mês, 12 parcelas
```

```text
empréstimo para Ana, CPF 52998224725, 1000 por 2000, 10 parcelas, todo dia 5
```

Se faltar CPF, o bot pede antes de avançar.

## 2) Conflito de CPF e nome

Quando o CPF já existe com outro nome, o bot pergunta qual regra usar:

```text
1) usar nome cadastrado
2) substituir para o novo nome
```

Só cria depois da sua escolha + confirmação final.

## 3) Baixar pagamento por contrato

Use o ID numérico retornado na criação (`Contrato #123`).

Exemplos:

```text
baixar contrato 123
baixar contrato 123 parcela 2
pagar parcela 2 do contrato 123
```

Sem parcela informada:
- o bot mostra 3 parcelas por vez
- você pode pedir `mostrar mais`
- a baixa só acontece com `sim`

## 4) Comandos rápidos

```text
/dashboard
/recebiveis
/contrato
/pagamento
/desconectar
```
