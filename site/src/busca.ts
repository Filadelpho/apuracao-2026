/** Campo de busca de municípios e estados, com navegação pelo teclado e atalho Ctrl/⌘+K */

/** peso: desempate entre nomes parecidos (eleitores); maior aparece antes */
export type Item = { codigo: string; nome: string; detalhe: string; peso: number };

const MAX_RESULTADOS = 8;

/** Sem acento, minúsculo: "São Paulo" e "sao paulo" batem */
const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function montarBusca(itens: () => Item[], aoEscolher: (item: Item) => void) {
  const campo = document.getElementById("busca-campo") as HTMLInputElement;
  const lista = document.getElementById("busca-lista")!;
  const atalho = document.getElementById("busca-atalho")!;
  if (/Mac|iPhone|iPad/.test(navigator.platform)) atalho.textContent = "⌘K";

  let resultados: Item[] = [];
  let ativo = 0;

  const fechar = () => {
    lista.hidden = true;
    campo.setAttribute("aria-expanded", "false");
  };

  const desenhar = () => {
    lista.innerHTML = resultados.length
      ? resultados
          .map((r, i) => `<li role="option" id="busca-op-${i}" aria-selected="${i === ativo}" data-i="${i}"><span>${r.nome}</span><small>${r.detalhe}</small></li>`)
          .join("")
      : `<li class="sem-resultado">Nenhum município encontrado</li>`;
    lista.hidden = false;
    campo.setAttribute("aria-expanded", "true");
    campo.setAttribute("aria-activedescendant", resultados.length ? `busca-op-${ativo}` : "");
  };

  const procurar = () => {
    const termo = normalizar(campo.value.trim());
    if (!termo) return fechar();
    // Nome igual ao digitado vem primeiro, depois os que começam com ele, depois os que o contêm
    const nota = (i: Item) => {
      const nome = normalizar(i.nome);
      return nome === termo ? 0 : nome.startsWith(termo) ? 1 : nome.includes(termo) ? 2 : 3;
    };
    resultados = itens()
      .map((i) => ({ i, n: nota(i) }))
      .filter((r) => r.n < 3)
      .sort((a, b) => a.n - b.n || b.i.peso - a.i.peso)
      .slice(0, MAX_RESULTADOS)
      .map((r) => r.i);
    ativo = 0;
    desenhar();
  };

  const escolher = (item: Item | undefined) => {
    if (!item) return;
    campo.value = "";
    fechar();
    campo.blur();
    aoEscolher(item);
  };

  campo.addEventListener("input", procurar);
  campo.addEventListener("focus", procurar);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!resultados.length) return;
      ativo = (ativo + (e.key === "ArrowDown" ? 1 : resultados.length - 1)) % resultados.length;
      desenhar();
    } else if (e.key === "Enter") {
      escolher(resultados[ativo]);
    } else if (e.key === "Escape") {
      fechar();
      campo.blur();
    }
  });
  // mousedown em vez de click: o clique precisa valer antes de o campo perder o foco
  lista.addEventListener("mousedown", (e) => {
    const li = (e.target as Element).closest<HTMLElement>("li[data-i]");
    if (li) {
      e.preventDefault();
      escolher(resultados[Number(li.dataset.i)]);
    }
  });
  campo.addEventListener("blur", () => setTimeout(fechar, 100));

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      campo.focus();
      campo.select();
    }
  });
}
