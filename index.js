// @ts-check
/**
 * @typedef {Object} Config
 * @property {boolean} bail - True to throw an error for each failed audit. False to use warnings instead. Defaults to false.
 * @property {boolean | string} optimizationBailout - Optional optimizationBailout results exported to a file. Set to true of filename.
 * @property {GimbalOptions} options - Gimbal options
 */

/**
 * @typedef {Object} GimbalOptions
 * @prop {string} buildDir - Build directory relative to outputPath
 * @prop {boolean} [comment] - Output comments
 * @prop {boolean} [verbose] - Verbose output for debugging
 * @prop {boolean} [checkThresholds] - Check custom thresholds. Defaults to true
 * @prop {boolean} [size] - Run size audit
 * @prop {boolean} [calculateUnusedSource] - Run unused source audit
 * @prop {boolean} [heapSnapshot] - Run heap size audit
 * @prop {boolean} [lighthouse] - Run lighthouse audit
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

const fs = require('fs');

module.exports = class GimbalPlugin {
  constructor(options) {
    const defaults = {
      bail: false,
      optimizationBailout: false,
      options: {
        buildDir: '',
        comment: true,
        verbose: false,
        checkThresholds: true,
        size: true,
        calculateUnusedSource: true,
        heapSnapshot: true,
        lighthouse: true,
      },
    };

    const cfg = Object.assign({}, defaults, options);

    /** @type {Config} */
    this.cfg = cfg;
  }

  async executeAudits(context, compilation, cb) {
    if (process.env.NODE_ENV !== 'production') {
      // We only want Gimbal to run in prod
      cb();
      return;
    }

    const { audit } = require('@modus/gimbal');

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
   * @param {GimbalResults}  results - Gimbal audit results
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

    if (this.cfg.optimizationBailout) {
      compiler.hooks.done.tapAsync(
        {
          name: 'GimbalPlugin',
          context: true,
        },
        stats => {
          const optimizationBailout = this.cfg.optimizationBailout;
          const bailout = stats
            .toJson({ optimizationBailout: true, maxModules: Infinity })
            .modules.map(mod =>
              Array.isArray(mod.optimizationBailout) && mod.optimizationBailout.length
                ? [mod.name, mod.optimizationBailout, mod.chunks]
                : false,
            )
            .filter(Boolean)
            .filter(([name]) => !name.match(/node_modules|\(webpack\)|\(ignored\)|^multi/))
            .filter(([, modules]) => !modules.toString().match(/import\(\)|HMR/));

          const fileName = typeof optimizationBailout === 'string' ? optimizationBailout : 'bailout.json';
          // @ts-ignore
          fs.writeFile(fileName, JSON.stringify(bailout), 'utf8');
        },
      );
    }
  }
};
