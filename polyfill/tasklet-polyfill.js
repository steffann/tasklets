(function() {
  function pingPongMessage(target, msg, transferables) {
    const id = performance.now();

    return new Promise(resolve => {
      target.addEventListener('message', function handler(event) {
        if(event.data.id !== id) return;
        target.removeEventListener('message', handler);
        resolve(event);
      });
      target.postMessage(Object.assign(msg, {id}), transferables);
    });
  }

  function isTransferable(thing) {
    return (thing instanceof ArrayBuffer) ||
      (thing instanceof ImageBitmap) ||
      (thing instanceof MessagePort);
  }

  function makeItAProxyAllTheWayDown(port) {
    let callPath = [];
    const proxy = new Proxy(function() {}, {
      async apply(_, __, argumentsList) {
        const response = await pingPongMessage(port, {
          type: 'APPLY',
          callPath,
          argumentsList,
        });
        return response.data.result;
      },
      get(_, property, __) {
        callPath.push(property);
        return proxy;
      },
    });
    return proxy;
  }

  function *iterateAllProperties(obj) {
    if(!obj) return;
    const vals = Object.values(obj);
    yield* vals;
    for(const val of vals)
      yield* iterateAllProperties(val);
  }

  class Tasklets {
    constructor(worker) {
      this._worker = worker;
    }

    async addModule(path) {
      const response = await pingPongMessage(this._worker, {
        path,
      });
      if('error' in response.data)
        throw Error(response.data.error);


      const that = this;
      const port = response.data.port;
      port.start();
      const proxyCollection = {};
      for(const exportName of event.data.structure) {
        proxyCollection[exportName] = new Proxy(function(){}, {
          async apply(_, __, argumentsList) {
            // TODO: Actually walk the entire tree
            const transferableArguments = Array.from(iterateAllProperties(argumentsList)).filter(val => isTransferable(val));
            const response = await pingPongMessage(
              port,
              {
                path,
                exportName,
                type: 'APPLY',
                argumentsList,
              }, transferableArguments);
            return response.data.result;
          },
          construct(_, argumentsList, __) {
            const {port1, port2} = new MessageChannel();
            port1.start();
            pingPongMessage(
              port,
              {
                path,
                exportName,
                type: 'CONSTRUCT',
                argumentsList,
                port: port2,
              }, [port2]);
            return makeItAProxyAllTheWayDown(port1);
          },
        });
      }
      return proxyCollection;
    }

    terminate() {
      this._worker.terminate();
    }
  }

  const scriptURL = new URL(document.currentScript.src);
  const parts = scriptURL.pathname.split('/');
  parts.pop();
  scriptURL.pathname = `${parts.join('/')}/tasklet-worker-env.js`;
  scriptURL.search = '';
  const worker = new Worker(scriptURL.toString());
  self.tasklets = new Tasklets(worker);
})();
