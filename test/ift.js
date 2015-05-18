var assert = require('assert');
var ift = require('../library/ift');
var Transport = require('../library/base/transport');
var util = require('./util');

describe('ift', function() {
  var createIframe = sinon.stub(), _createIframe;

  // Hook into ParentTransport#_createIframe to attach a `code` query param
  // containing a raw function to execute on the child page for a given test.
  _createIframe = ift.ParentTransport.prototype._createIframe;
  function stubChild(code) {
    createIframe = sinon.stub(ift.ParentTransport.prototype, '_createIframe', function(uri) {
      return _createIframe.call(this, uri + '?code=' + encodeURIComponent(code));
    });
  }

  function dispatchMessageEvent(data, origin) {
    util.dispatchEvent(window, 'message', {
      data: data,
      origin: origin
    }, 'MessageEvent', ['data', 'origin']);
  }

  describe('Transport', function() {
    it("ignores 'message' events from non-targeted origins", function() {
      var incoming = sinon.stub();
      var transport = new Transport(['http://origin1']);
      transport.on('incoming', incoming);
      dispatchMessageEvent('data', 'http://origin1');
      sinon.assert.calledOnce(incoming);
      dispatchMessageEvent('data', 'http://origin2');
      sinon.assert.calledOnce(incoming);
    });

    describe('#destroy', function() {
      it("stops listening for 'message'", function() {
        var transport = new Transport(['http://origin']);
        var incoming = sinon.stub();
        transport.on('incoming', incoming);
        dispatchMessageEvent('data', 'http://origin');
        sinon.assert.calledOnce(incoming);
        transport.destroy();
        dispatchMessageEvent('data', 'http://origin');
        sinon.assert.calledOnce(incoming);
      });

      it("clears out event listeners", function() {
        var transport = new Transport(['http://origin']);
        var incoming = sinon.stub();
        transport.on('incoming', incoming);
        transport.trigger('incoming');
        sinon.assert.calledOnce(incoming);
        transport.destroy();
        transport.trigger('incoming');
        sinon.assert.calledOnce(incoming);
      });
    });
  });

  describe('ParentTransport', function() {
    it("creates an iframe from childOrigin and childPath", function() {
      var appendChild = sinon.stub(document.body, 'appendChild');
      var transport = new ift.ParentTransport('http://origin', '/path');
      assert.strictEqual(transport.iframe.src, 'http://origin/path');
      appendChild.restore();
    });

    it("creates an iframe not visible on the page", function() {
      var transport = new ift.ParentTransport(CHILD_ORIGIN, CHILD_PATH);
      assert(transport.iframe.offsetTop < 100);
      assert.strictEqual(transport.iframe.border, 0);
      assert.strictEqual(transport.iframe.frameBorder, '0');
    });

    describe('#ready', function() {
      var appendChild, transport, onReady;

      beforeEach(function() {
        appendChild = sinon.stub(document.body, 'appendChild');
        transport = new ift.ParentTransport('http://origin', '/path');
        onReady = sinon.stub();
      });

      afterEach(function() {
        appendChild.restore();
      });

      it("invokes onReady once child sends 'ready' postMessage", function() {
        transport.ready(onReady);
        sinon.assert.notCalled(onReady);
        dispatchMessageEvent('ready', 'http://origin');
        sinon.assert.calledOnce(onReady);
        sinon.assert.calledWith(onReady, transport);
      });

      it("only invokes onReady once", function() {
        transport.ready(onReady);
        sinon.assert.notCalled(onReady);
        dispatchMessageEvent('ready', 'http://origin');
        sinon.assert.calledOnce(onReady);
        dispatchMessageEvent('ready', 'http://origin');
        sinon.assert.calledOnce(onReady);
        transport.trigger('ready');
        sinon.assert.calledOnce(onReady);
      });

      it("fires immediately if transport is already ready", function() {
        dispatchMessageEvent('ready', 'http://origin');
        transport.ready(onReady);
        sinon.assert.calledOnce(onReady);
      });
    });

    describe('#send', function() {
      it("calls postMessage on the iframe with message and childOrigin", function() {
        var transport = new ift.ParentTransport(CHILD_ORIGIN, CHILD_PATH);
        var postMessage = sinon.stub(transport.iframe.contentWindow, 'postMessage');
        transport.send('test');
        sinon.assert.calledOnce(postMessage);
        sinon.assert.calledWith(postMessage, 'test', CHILD_ORIGIN);
        postMessage.restore();
      });
    });

    describe('#destroy', function() {
      it("removes iframe from the dom", function() {
        var transport = new ift.ParentTransport(CHILD_ORIGIN, CHILD_PATH);
        assert(transport.iframe.parentNode);
        transport.destroy();
        assert.strictEqual(transport.iframe.parentNode, null);
      });
    });
  });

  describe('ChildTransport', function() {
    it("sends 'ready' message on instantiation", function() {
      var parent = window.parent;
      window.parent = {
        postMessage: sinon.stub()
      };
      var transport = new ift.ChildTransport(['http://origin']);
      sinon.assert.calledOnce(window.parent.postMessage);
      sinon.assert.calledWith(window.parent.postMessage, 'ready', '*');
      window.parent = parent;
    });
  });

  describe('Channel', function() {
    var serialize, deserialize;
    before(function() {
      // Perhaps move de/serialize into Transport
      serialize = sinon.stub(ift.Channel.prototype, 'serialize', sinon.stub().returnsArg(0));
      deserialize = sinon.stub(ift.Channel.prototype, 'deserialize', sinon.stub().returnsArg(0));
    });
    after(function() {
      serialize.restore();
      deserialize.restore();
    });

    it("ignores messages from other channels", function() {
      var transport = new Transport(['http://origin']);
      var channel = new ift.Channel('test', transport);
      var process = sinon.stub(channel, 'process');
      transport.trigger('incoming', {
        channel: 'test',
        data: {}
      });
      sinon.assert.calledOnce(process);
      transport.trigger('incoming', {
        channel: 'other',
        data: {}
      });
      sinon.assert.calledOnce(process);
    });
  });
});
