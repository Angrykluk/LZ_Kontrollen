export function configureMathJax() {
  window.MathJax = {
    loader: { load: ['[tex]/mhchem'] },
    tex: {
      packages: { '[+]': ['mhchem'] },
      inlineMath: [['\\(', '\\)']],
      displayMath: [['\\[', '\\]']]
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    }
  };
}

export async function typesetMath(root = document.body) {
  if (window.MathJax && window.MathJax.typesetPromise) {
    await window.MathJax.typesetPromise([root]);
  }
}
