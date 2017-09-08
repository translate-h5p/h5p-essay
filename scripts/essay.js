var H5P = H5P || {};

H5P.Essay = function ($, Question) {
  'use strict';
  /**
   * @constructor
   *
   * @param {object} config - Config from semantics.json.
   * @param {string} contentId - ContentId.
   * @param {object} contentData - contentData.
   */
  function Essay(config, contentId, contentData) {
    // Initialize
    if (!config) {
      return;
    }

    // Inheritance
    Question.call(this, 'essay');

    this.config = config;
    this.contentId = contentId;
    this.contentData = contentData || {};

    // map function
    var toPoints = function (keywordGroup) {
      return keywordGroup.options && keywordGroup.options.points || 0;
    };

    // reduce function
    var sum = function (a, b) {
      return a + b;
    };

    var scoreMax = this.config.keywordGroups
      .map(toPoints)
      .reduce(sum, 0);

    // Set scores
    this.scoreMastering = (typeof this.config.behaviour.scoreMastering === 'undefined') ? Infinity : this.config.behaviour.scoreMastering;
    // We want scoreMastering to be the maximim score shown on the feedback progress bar
    this.scoreMastering = Math.min(scoreMax, this.scoreMastering);
    this.scorePassing = Math.min(this.scoreMastering, this.config.behaviour.scorePassing || 0);
  }

  // Extends Question
  Essay.prototype = Object.create(Question.prototype);
  Essay.prototype.constructor = Essay;

  /**
   * Register the DOM elements with H5P.Question.
   */
  Essay.prototype.registerDomElements = function() {
    var that = this;

    // Get previous state
    if (!!this.contentData && !!this.contentData.previousState) {
      that.previousState = this.contentData.previousState;
    }
    var oldText = (!!that.previousState) ? that.previousState.text || '' : '';

    /*
     * This is a little ugly for several reasons. First of all, it would be
     * nicer if H5P.TextInputField had a function to return the HTML for
     * introduction and content. However, this way we don't have to touch that
     * code right now. Secondly, we use jQuery. H5P is going to ditch it, but
     * we can use the existing attach method.
     * TODO: Get rid of jQuery and change H5P.TextInputField as soon as the
     *       H5P core runs without jQuery.
     */
    var $wrapperInputfield = $('<div>');
    that.inputField = new H5P.TextInputField(this.config.inputField.params,
      this.contentId, {
        'standalone': true,
        'previousState': oldText
      });
    that.inputField.attach($wrapperInputfield);

    // Register task introduction text
    that.setIntroduction($wrapperInputfield.children().get(0));

    // Register content
    that.setContent($wrapperInputfield.get(0));

    // Register Buttons
    this.addButtons();

    this.trigger(this.createEssayXAPIEvent('experienced'));
  };

  /**
   * Create an xAPI event for Essay.
   * @param {string} verb - Short id of the verb we want to trigger.
   * @return {H5P.XAPIEvent} Event template.
   */
  Essay.prototype.createEssayXAPIEvent = function (verb) {
    var xAPIEvent = this.createXAPIEventTemplate(verb);
    this.extend(xAPIEvent.getVerifiedStatementValue(['object', 'definition']), this.getxAPIDefinition());
    return xAPIEvent;
  };

  /**
   * Add all the buttons that shall be passed to H5P.Question
   */
  Essay.prototype.addButtons = function () {
    var that = this;

    // Check answer button
    that.addButton('check-answer', that.config.checkAnswer, function () {
      that.showEvaluation();
    }, true, {}, {});

    // Retry button
    that.addButton('try-again', that.config.tryAgain, function () {
      that.showEvaluation();
    }, false, {}, {});
  };

  /**
   * Show results.
   */
  Essay.prototype.showEvaluation = function () {
    var that = this;

    var feedback = that.computeFeedback();

    // map function
    var toMessages = function (text) {
      return text.message;
    };

    // reduce function
    var combine = function (a, b) {
      return a.trim() + ' ' + b.trim();
    };

    // TODO: This could possibly be made nicer visually if we use the info about found/missing using a filter
    var feedbackMessage = feedback.text
      .map(toMessages)
      .reduce(combine, '');
    feedbackMessage = (feedbackMessage !== '') ? feedbackMessage = feedbackMessage + '<br />' : feedbackMessage;

    var score = Math.min(feedback.score, that.scoreMastering);

    var textScore = H5P.Question.determineOverallFeedback(that.config.overallFeedback, score / that.scoreMastering)
      .replace('@score', score)
      .replace('@total', that.scoreMastering);

    this.setFeedback(
      feedbackMessage + textScore,
      score,
      that.scoreMastering);

    that.hideButton('check-answer');
    this.trigger(this.createEssayXAPIEvent('completed'));

    var xAPIEvent = this.createEssayXAPIEvent('scored');
    xAPIEvent.setScoredResult(score, that.scoreMastering, this, true, feedback.score >= that.scorePassing);
    xAPIEvent.data.statement.result.response = this.getInput();
    this.trigger(xAPIEvent);

    if (feedback.score < that.scorePassing) {
      this.trigger(this.createEssayXAPIEvent('failed'));
    }
    else {
      this.trigger(this.createEssayXAPIEvent('passed'));
    }

    if (score < that.scoreMastering) {
      if (that.config.behaviour.enableRetry) {
        that.showButton('try-again');
      }
    }
    else {
      this.trigger(this.createEssayXAPIEvent('mastered'));
      that.hideButton('try-again');
    }
  };

  /**
   * Get the user input from DOM.
   * @return {String} Cleaned input.
   */
  Essay.prototype.getInput = function () {
    return this.inputField.getInput().value
      .replace(/(\r\n|\r|\n)/g, ' ')
      .replace(/\s\s/g, ' ');
  };

  /**
   * Compute the feedback.
   * TODO: Could also return the position and the (fuzzy) word found
   * @return {object} Feedback of {score: number, text: [{message: String, found: boolean}]}.
   */
  Essay.prototype.computeFeedback = function() {
    var that = this;
    var score = 0;
    var text = [];

    // We don't want EOLs to mess up the string.
    var input = this.getInput();
    var inputLowerCase = input.toLowerCase();

    // Should not happen, but just to be sure ...
    this.config.keywordGroups = this.config.keywordGroups || [];

    /*
     * If you don't want to only find exact matches of keywords, but also
     * close resemblences or phrases, things get more complicated then you
     * might expect. This could probably be improved.
     */

    // Within each keyword group check if one of the alternatives is a keyword

    this.config.keywordGroups.forEach(function (alternativeGroup) {
      var found = alternativeGroup.alternatives.some(function (candidate) {
        var alternative = candidate.alternative;
        var options = candidate.options;

        var inputTest = input;

        // Check for case sensitivity
        if  (!options.caseSensitive || that.config.behaviour.overrideCaseSensitive === 'off') {
          alternative = alternative.toLowerCase();
          inputTest = inputLowerCase;
        }

        // Exact matching
        if (inputTest.indexOf(alternative) !== -1 && H5P.TextUtilities.isIsolated(alternative, inputTest)) {
          score += alternativeGroup.options.points;
          if (alternativeGroup.options.feedbackFound) {
            text.push({"message": alternativeGroup.options.feedbackFound, "found": true});
          }
          return true;
        }

        // Fuzzy matching
        if ((options.forgiveMistakes || that.config.behaviour.overrideForgiveMistakes === 'on') && H5P.TextUtilities.fuzzyContains(alternative, inputTest)) {
          score += alternativeGroup.options.points;
          if (alternativeGroup.options.feedbackFound) {
            text.push({"message": alternativeGroup.options.feedbackFound, "found": true});
          }
          return true;
        }
      });
      if (!found) {
        if (alternativeGroup.options.feedbackMissed) {
          text.push({"message": alternativeGroup.options.feedbackMissed, "found": false});
        }
      }
    });

    return {"score": score, "text": text};
  };

  /**
   * Store the current content content state
   * @return {object} current content state
   */
  Essay.prototype.getCurrentState = function () {
    // Collect data from TextInputField (we might need more later)
    var textInputField = '';
    if (this.inputField.getCurrentState instanceof Function || typeof this.inputField.getCurrentState === 'function') {
      textInputField = this.inputField.getCurrentState();
    }
    return {
      'text': textInputField
    };
  };

  /**
   * Extend an array just like JQuery's extend.
   * @param {object} arguments - Objects to be merged.
   * @return {object} Merged objects.
   */
  Essay.prototype.extend = function () {
    for(var i = 1; i < arguments.length; i++) {
      for(var key in arguments[i]) {
        if (arguments[i].hasOwnProperty(key)) {
          if (typeof arguments[0][key] === 'object' && typeof arguments[i][key] === 'object') {
            this.extend(arguments[0][key], arguments[i][key]);
          }
          else {
            arguments[0][key] = arguments[i][key];
          }
        }
      }
    }
    return arguments[0];
  };

  /**
   * Get the xAPI definition for the xAPI object.
   * return {object} XAPI definition.
   */
  Essay.prototype.getxAPIDefinition = function () {
    var definition = {};
    definition.name = {'en-US': 'Essay'};
    definition.description = {'en-US': this.config.inputField.params.taskDescription};
    definition.type = 'http://id.tincanapi.com/activitytype/essay';
    definition.interactionType = 'long-fill-in';
    return definition;
  };

  return Essay;
}(H5P.jQuery, H5P.Question);
