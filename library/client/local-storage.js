/*
 * IFrameTransport - LocalStorage Client
 *
 * Persist data across domains.
 * Targets modern browsers, IE8+
*/

(function (root, factory) {
  if (typeof define === 'function' && define.amd) define('ift-ls-client', ['ift'], factory);
  else root.IFT = factory(root.IFT);
}(this, function(IFT) {

  var support = IFT.support;

  // Parent
  // ------

  // Implement the LocalStorage client from the parent's perspective.
  var Parent = IFT.Client.extend({

    get: function(key, callback) {
      this.send('invoke', 'get', [key], callback);
    },

    set: function(key, value, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      } else options = options || {};

      this.send('invoke', 'set', [key, value, options], callback);
    },

    unset: function(key, callback) {
      this.send('invoke', 'unset', [key], callback);
    }

  });

  // Implement the LocalStorage client from the child's perspective.
  var Child = IFT.Client.extend({

    constructor: function() {
      this._listen();
      IFT.Client.apply(this, arguments);
    },

    get: function(key) {
      return localStorage.getItem(key);
    },

    set: function(key, value, options) {
      if (support.ignoreMyWrites) this._writing = true;
      return localStorage.setItem(key, value);
    },

    unset: function(key) {
      return localStorage.removeItem(key);
    },

    _listen: function() {
      var self = this;
      var target = support.storageEventTarget;
      support.on(target, 'storage', function(evt) { self._onStorage(evt); });

      if (support.ignoreMyWrites) {
        support.on(target, 'storagecommit', function() { this._writing = false; });
      }
    },

    _onStorage: function(evt) {
      if (this._writing) {
        return this._writing = false;
      }

      this.send('trigger', 'change', [evt.key, evt.oldValue, evt.newValue]);
    }

  });

  // Register this client in the library under the unique type: `ls`.
  IFT.Client.register('ls', Parent, Child);

  return IFT;

}));
