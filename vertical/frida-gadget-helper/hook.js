Java.perform(function () {
  console.log('[hook] Java is ready');

  // var Target = Java.use('com.xxx.TargetClass');
  // Target.targetMethod.implementation = function (arg) {
  //   console.log('[hook] targetMethod arg=' + arg);
  //   var ret = this.targetMethod(arg);
  //   console.log('[hook] targetMethod ret=' + ret);
  //   return ret;
  // };
});
