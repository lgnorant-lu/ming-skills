// 独立文件而非内联脚本，这样调试器能拿到真实的 source URL。
function computeTotal(price, quantity) {
  const subtotal = price * quantity;
  const taxRate = 0.08;
  const marker = "scope-probe";
  const total = subtotal * (1 + taxRate);
  return total;
}

window.runComputation = function (price, quantity) {
  const result = computeTotal(price, quantity);
  document.getElementById("out").textContent = "total=" + result;
  return result;
};

// 供「异常时自动暂停」测试使用
window.boom = function () {
  const missing = null;
  return missing.property.that.does.not.exist;
};
