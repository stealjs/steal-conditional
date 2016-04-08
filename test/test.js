var loader = require("@loader");
var helpers = require("./runner-helpers")(System);

require("../conditional");

QUnit.module("conditional extension normalize");

QUnit.test("throws if condition has a dot in the name", function(assert) {
	assert.throws(
		function() {
			loader.normalize("jquery/#{.browser}");
		},
		/Condition modules cannot contain ./
	);
});

QUnit.test("throws if condition has a / in the name", function(assert) {
	assert.throws(
		function() {
			loader.normalize("jquery/#{/browser}");
		},
		/Condition modules cannot contain . or \//
	);
});

QUnit.module("with invalid substitution module export", function(hooks) {
	hooks.beforeEach(function() {
		this.oldImport = loader.import;

		loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ default: 42 }) :
				Promise.reject();
		};
	});

	hooks.afterEach(function() {
		loader.import = this.oldImport;
	});

	QUnit.test("rejects promise", function(assert) {
		var done = assert.async();

		// browser's default export must be a string
		loader.normalize("jquery/#{browser}")
			.then(function() {
					assert.ok(false, "should be rejected");
					done();
				})
				.catch(function(err) {
					var re = /doesn't resolve to a string/;
					assert.ok(re.test(err.message));
					done();
				});
		});
});

QUnit.module("with invalid condition module export", function(hooks) {
	hooks.beforeEach(function() {
		this.oldImport = loader.import;

		loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ hasFoo: "not a boolean" }) :
				Promise.reject();
		};
	});

	hooks.afterEach(function() {
		loader.import = this.oldImport;
	});

	QUnit.test("rejects promise", function(assert) {
		var done = assert.async();

		// browser.hasFoo must be a boolean
		loader.normalize("jquery#?browser.hasFoo")
			.then(function() {
				assert.ok(false, "should be rejected");
				done();
			})
			.catch(function(err) {
				var re = /isn't resolving to a boolean/;
				assert.ok(re.test(err.message));
				done();
			});
	});
});

QUnit.module("with valid substitution module export", function(hooks) {
	hooks.beforeEach(function() {
		this.oldImport = loader.import;

		loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ default: "chrome" }) :
				Promise.reject();
		};
	});

	hooks.afterEach(function() {
		loader.import = this.oldImport;
	});

	QUnit.test("works", function(assert) {
		var done = assert.async();

		// browser.hasFoo must be a boolean
		loader.normalize("jquery/#{browser}")
			.then(function(name) {
				assert.equal(name, "jquery/chrome");
				done();
			});
	});
});

QUnit.module("when condition evalutes to false", function(hooks) {
	hooks.beforeEach(function() {
		this.oldImport = loader.import;

		loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ hasFoo: false }) :
				Promise.reject();
		};
	});

	hooks.afterEach(function() {
		loader.import = this.oldImport;
	});

	QUnit.test("normalizes name to special @empty module", function(assert) {
		var done = assert.async();

		loader.normalize("jquery#?browser.hasFoo")
			.then(function(name) {
				assert.equal(name, "@empty");
				done();
			});
	});
});

QUnit.module("when condition evalutes to true", function(hooks) {
	hooks.beforeEach(function() {
		this.oldImport = loader.import;

		loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ hasFoo: true}) :
				Promise.reject();
		};
	});

	hooks.afterEach(function() {
		loader.import = this.oldImport;
	});

	QUnit.test("removes the condition from the module name", function(assert) {
		var done = assert.async();

		loader.normalize("jquery#?browser.hasFoo")
			.then(function(name) {
				assert.equal(name, "jquery");
				done();
			});
	});
});

QUnit.module("with boolean conditional in a npm package name", function(hooks) {
	hooks.beforeEach(function() {
		this.loader = helpers.clone()
			.rootPackage({
				name: "parent",
				main: "main.js",
				version: "1.0.0"
			})
			.withPackages([
				{
				name: "jquery",
				main: "main.js",
				version: "1.0.0"
			}
			]).loader;

		this.loader.import = function(conditionModule) {
			return conditionModule === "browser" ?
				Promise.resolve({ hasFoo: true }) :
				Promise.reject();
		};
	});

	QUnit.test("normalizes the npm package name correctly", function(assert) {
		var done = assert.async();

		return this.loader.normalize("jquery#?browser.hasFoo")
			.then(function(name) {
				assert.equal(name, "jquery@1.0.0#main");
				done();
			});
	});
});

