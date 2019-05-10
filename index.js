// @ts-check
const { audit } = require('@modus/gimbal');

/**
 * @typedef {Object} Config
 * @property {boolean} bail - True to throw an error for each failed audit. False to use warnings instead. Defaults to false.
 * @property {GimbalOptions} options - Gimbal options
 */

/**
 * @typedef {Object} GimbalOptions
 * @prop {string} buildDir - Build directory relative to outputPath
 * @prop {boolean} [comment] - Output comments
 * @prop {boolean} [verbose] - Verbose output for debugging
 * @prop {boolean} [checkThresholds] - Check custom thresholds. Defaults to true
 */

/**
 * @typedef {Object} GimbalResults
 * @prop {GimbalJobResult[]} data - Audit Jobs
 * @prop {boolean} [success] - False if at least one audit job was unsuccessful
 */

/**
 * @typedef {Object} GimbalJobResult
 * @prop {GimbalJobReport[]} data - Audit Jobs
 * @prop {string} label - Job name
 * @prop {boolean} [success] - False if at least one report was unsuccessful
 */

/**
 * @typedef {Object} GimbalJobReport
 * @prop {string} label - Report name
 * @prop {string} value - Reported value
 * @prop {string} threshold - Threshold value
 * @prop {boolean} [success] - Success
 */

module.exports = class GimbalPlugin {
  constructor(options) {
    const defaults = {
      bail: false,
      options: {
        buildDir: '',
        comment: true,
        verbose: false,
        checkThresholds: true,
      },
    };

    const cfg = Object.assign({}, defaults, options);

    /** @type {Config} */
    this.cfg = cfg;
  }

  async executeAudits(context, compilation, cb) {
    if (compilation.options.mode !== 'production') {
      // We only want Gimbal to run in prod
      cb();
    }

    const reportProgress = context && context.reportProgress;
    if (reportProgress) reportProgress(0, 'Starting performance audit');

    const results = await audit(
      Object.assign(
        {
          cwd: compilation.compiler.outputPath,
          buildDir: '',
          comment: true,
          verbose: false,
          checkThresholds: true,
        },
        this.cfg.options,
      ),
    );

    if (reportProgress) reportProgress(1, 'Performance audit complete');

    if (results.success === false) {
      this.processMessages(compilation, results);
    }

    cb();
  }
  /**
   * @param {GimbalResults}  results - A string param.
   */
  processMessages(compilation, results) {
    const failed = results.data.filter(result => !result.success);

    failed.forEach(category => {
      category.data
        .filter(result => !result.success)
        .forEach(failure => {
          const msg = `[Gimbal: ${category.label}] ${failure.label}: ${failure.value} (threshold ${
            failure.threshold
          }).`;
          if (this.cfg.bail) {
            compilation.errors.push(msg);
          } else {
            compilation.warnings.push(msg);
          }
        });
    });
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync(
      {
        name: 'GimbalPlugin',
        context: true,
      },
      this.executeAudits.bind(this),
    );
  }
};
