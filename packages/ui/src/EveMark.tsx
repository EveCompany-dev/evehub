'use client';

import type { JSX } from 'react';

/**
 * O simbolo da Eve (o "portal").
 *
 * Geometria pura, reproduzida exatamente: um retangulo cujo topo e um
 * semicirculo de raio igual a metade da largura. Herda a cor via currentColor,
 * entao funciona em laranja, branco ou preto sem variantes de arquivo.
 */
export function EveArch({ size = 26, title }: { size?: number; title?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M0 100 L0 50 A50 50 0 0 1 100 50 L100 100 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Versao concentrica do simbolo (o "tunel"), usada como marca d'agua.
 * Os aneis sao gerados, nao desenhados a mao.
 */
export function EveArchRings({ size = 120, rings = 14 }: { size?: number; rings?: number }): JSX.Element {
  const paths = Array.from({ length: rings }, (_, index) => {
    const inset = (index * 50) / rings;
    const x = inset;
    const width = 100 - inset * 2;
    const radius = width / 2;
    return (
      <path
        key={index}
        d={`M${x} 100 L${x} ${50 + inset / 2} A${radius} ${radius} 0 0 1 ${x + width} ${50 + inset / 2} L${x + width} 100`}
        stroke="currentColor"
        strokeWidth={0.9}
        fill="none"
      />
    );
  });

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {paths}
    </svg>
  );
}

/**
 * Logotipo "eve.company".
 *
 * PLACEHOLDER TIPOGRAFICO. O "eve" da marca e um logotipo desenhado, nao uma
 * fonte — nao da para reproduzir fielmente em codigo. Quando exportarem o SVG
 * oficial, troque o conteudo deste componente por ele; todo o resto (animacao,
 * layout, tema) continua igual, porque nada mais depende disso.
 */
export function EveWordmark({ suffix = '.company' }: { suffix?: string }): JSX.Element {
  return (
    <span className="eve-wordmark" aria-label={`eve${suffix}`}>
      <span className="eve-wordmark__eve">eve</span>
      <span className="eve-wordmark__suffix">{suffix}</span>
    </span>
  );
}

/**
 * Lockup do cabecalho: o portal fica fixo e o logotipo desliza por tras dele
 * para a direita no hover/foco, depois recolhe. Respeita prefers-reduced-motion
 * (a animacao vira um fade).
 */
export function EveBrandLockup({ suffix = '.company' }: { suffix?: string }): JSX.Element {
  return (
    <span className="eve-lockup" tabIndex={0} role="img" aria-label={`eve${suffix}`}>
      {/* O portal vem primeiro no DOM e fica por cima (z-index + fundo opaco),
          para o logotipo parecer sair de tras dele. */}
      <span className="eve-lockup__arch" aria-hidden="true">
        <EveArch size={26} />
      </span>
      <span className="eve-lockup__reveal" aria-hidden="true">
        <span className="eve-lockup__slide">
          <EveWordmark suffix={suffix} />
        </span>
      </span>
    </span>
  );
}
