/*
 * IFrameTransport
 *
 * Invoke methods with callbacks and trigger events across domains.
 * Targets modern browsers, IE8+
*/

(function (root, factory) {
  if (typeof define === 'function' && define.amd) define('ift', factory);
  else root.IFT = factory();
}(this, function() {

  var slice = [].slice;

  var IFT = {};

  // Support
  // -------

  var support = IFT.support = {
    ignoreMyWrites: ('onstorage' in document),
    storageEventTarget: ('onstorage' in document ? document : window)
  };

  // http://peter.michaux.ca/articles/feature-detection-state-of-the-art-browser-scripting
  support.has = function(object, property){
    var t = typeof object[property];
    return t == 'function' || (!!(t == 'object' && object[property])) || t == 'unknown';
  }

  if (support.has(window, 'addEventListener')) {
    support.on = function(target, name, callback) {
      target.addEventListener(name, callback, false);
    }
    support.off = function(target, name, callback) {
      target.removeEventListener(name, callback, false);
    }
  } else if (support.has(window, 'attachEvent')) {
    support.on = function(object, name, callback) {
      object.attachEvent('on' + name, function() { callback(window.event) });
    }
    support.off = function(object, name, callback) {
      object.detachEvent('on' + name, function() { callback(window.event) });
    }
  }


  // Utility
  // -------

  // (ref `_.extend`)
  // Extend a given object with all the properties in passed-in object(s).
  var mixin = function(obj) {
    var args = slice.call(arguments, 1),
        props;
    for (var i = 0; i < args.length; i++) {
      if (props = args[i]) {
        for (var prop in props) {
          obj[prop] = props[prop];
        }
      }
    }
  }

  // (ref Backbone `extend`)
  // Helper function to correctly set up the prototype chain, for subclasses.
  var extend = function(props) {
    var parent = this;
    var child;

    if (props && props.hasOwnProperty('constructor')) {
      child = props.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    mixin(child.prototype, props);

    return child;
  };

  // Events
  // ------

  // (ref `Backbone.Events`)
  // A module that can be mixed in to *any object* to provide it with custom events.
  var Events = {

    on: function(name, callback, context) {
      this._events || (this._events = {});
      (this._events[name] = this._events[name] || []).push({
        callback: callback,
        context: context || this
      });
      return this;
    },

    off: function(name, callback) {
      if (!this._events) return this;

      var listeners = this._events[name],
          i = listeners.length,
          listener;
      while (i--) {
        listener = listeners[i];
        if (listener.callback === callback) {
          listeners.splice(i, 1);
        }
      }
    },

    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);

      var listeners = this._events[name] || [],
          i = listeners.length;
      while (i--) {
        listeners[i].callback.apply(listeners[i].context, args);
      }
    }

  };

  // Transport
  // ---------

  // Base class for wrapping `iframe#postMessage` to facilitate method invocations and
  // callbacks and trigger events.
  var Transport = function(targetOrigin) {
    this.targetOrigin = targetOrigin;
    this._listen();
  };

  mixin(Transport.prototype, Events, {

    // Issue a new or return an existing client of a given type.
    client: function(type) {
      this._clients = this._clients || {};
      if (!this._clients[type]) {
        var ctor = IFT.Client.map(type, this.level);
        this._clients[type] = new ctor(this, type);
      }
      return this._clients[type];
    },

    // Send a `postMessage` that invokes a method. Optionally include a `callbackId` if a
    // callback is provided.
    _invoke: function(type, method, args, callback) {
      var params = {
        type: type,
        action: 'method',
        args: [method].concat(args)
      };
      if (typeof callback === 'function') {
        params.args.push({ callbackId: this._addCall(callback) });
      }

      this.send(params);
    },

    // Send a `postMessage` that triggers an event.
    _trigger: function(type, name, args) {
      var params = {
        type: type,
        action: 'event',
        args: [name].concat(args)
      };

      this.send(params);
    },

    // Send a `postMessage` that invokes a callback.
    _callback: function(type, callbackId, args) {
      var params = {
        type: type,
        action: 'callback',
        args: [callbackId].concat(args)
      };

      this.send(params);
    },

    // Associate a unique `callbackId` with the given callback function.
    _addCall: function(callback) {
      this._callbacks = this._callbacks || {};
      this._counter = this._counter || 0;
      this._callbacks[++this._counter] = callback;
      return this._counter;
    },

    // Listen for incoming `message`s on the iframe. Parse and trigger an event for
    // listening clients to act on.
    _listen: function() {
      var self = this;
      support.on(window, 'message', function(evt) {
        if (evt.origin == self.targetOrigin) {
          var message = JSON.parse(evt.data);
          var name = message.type + ':' + message.action;
          self.trigger.apply(self, [name].concat(message.args));
        }
      });
    }

  });

  // Client
  // ------

  // Base class for defining client APIs that may communicate over the iframe transport.
  // Clients may invoke methods with callbacks and trigger events.
  var Client = IFT.Client = function(ift, type) {
    this.ift = ift;
    this.type = type;

    // Listen for incoming actions to be processed by this client.
    this.ift.on(this.type + ':method', this._invoke, this);
    this.ift.on(this.type + ':event', this._trigger, this);
    this.ift.on(this.type + ':callback', this._callback, this);
  };

  // Static methods provide a library of available clients.
  mixin(Client, {

    // Register a client by unique type, providing parent and child constructor objects.
    register: function(type, parent, child) {
      this._map = this._map || {};
      this._map[type] = this._map[type] || {};
      this._map[type].parent = parent;
      this._map[type].child = child;
    },

    // Given a unique client type, obtain parent or child constructor object.
    map: function(type, level) {
      var ctor;
      if (this._map && this._map[type] && (ctor = this._map[type][level])) {
        return ctor;
      }
    }

  });

  // Client instance methods for sending actions or processing incoming actions.
  mixin(Client.prototype, Events, {

    // Send a method invocation, callback, or event.
    send: function(method) {
      var args = slice.call(arguments, 1);
      args = [this.type].concat(args);
      this.ift['_' + method].apply(this.ift, args);
    },

    // Process an incoming method invocation.
    _invoke: function(method) {
      var args = slice.call(arguments, 1), last = args[args.length - 1];
      var result = this[method].apply(this, args);
      if (last.callbackId) this.send('callback', last.callbackId, [result]);
    },

    // Process an incoming event.
    _trigger: function() {
      this.trigger.apply(this, arguments);
    },

    // Process an incoming callback.
    _callback: function(id) {
      var args = slice.call(arguments, 1);
      this.ift._callbacks[id].apply(this, args);
      this.ift._callbacks[id] = null;
    }

  });

  // Set up inheritance for the transport and client.
  Transport.extend = Client.extend = extend;

  // IFT.Parent
  // ----------

  // Implement the transport class from the parent's perspective.
  IFT.Parent = Transport.extend({

    constructor: function(childOrigin, path, name, callback) {
      this.childOrigin = childOrigin;
      this.childUri = childOrigin + path;
      this.name = name;
      this.iframe = this._createIframe(this.childUri, this.name, callback);

      Transport.apply(this, arguments);
    },

    level: 'parent',

    send: function(params) {
      var message = JSON.stringify(params);
      this.iframe.contentWindow.postMessage(message, this.childOrigin);
    },

    _createIframe: function(uri, name, callback) {
      var iframe = document.createElement('iframe');
      iframe.id = 'ift_' + name;
      iframe.name = 'ift_' + name;
      iframe.style.position = 'absolute';
      iframe.style.top = '-2000px';
      iframe.style.left = '0px';
      iframe.src = uri;
      iframe.border = iframe.frameBorder = 0;
      iframe.allowTransparency = true;

      support.on(iframe, 'load', callback);

      document.body.appendChild(iframe);

      return iframe;
    }

  });

  // IFT.Child
  // ---------

  // Implement the transport class from the child's perspective.
  IFT.Child = Transport.extend({

    constructor: function(parentOrigin) {
      this.parentOrigin = parentOrigin;
      this.parent = window.parent;

      Transport.apply(this, arguments);
    },

    level: 'child',

    send: function(params) {
      var message = JSON.stringify(params);
      this.parent.postMessage(message, this.parentOrigin);
    }

  });

  return IFT;

}));
