let startupPromise = null;

function getStartupPromise() {
  if (startupPromise) return startupPromise;

  startupPromise = new Promise((resolve) => {
    const waitForMathJax = () => {
      if (window.MathJax?.startup?.promise) {
        window.MathJax.startup.promise.then(resolve).catch(resolve);
        return;
      }

      if (window.MathJax?.typesetPromise) {
        resolve();
        return;
      }

      setTimeout(waitForMathJax, 50);
    };

    waitForMathJax();
  });

  return startupPromise;
}

export async function typesetMath(root = document.body) {
  await getStartupPromise();

  if (!window.MathJax?.typesetPromise) return;

  if (window.MathJax.typesetClear) {
    try {
      window.MathJax.typesetClear([root]);
    } catch (error) {
      console.warn('MathJax typesetClear fehlgeschlagen:', error);
    }
  }

  await window.MathJax.typesetPromise([root]);
}
