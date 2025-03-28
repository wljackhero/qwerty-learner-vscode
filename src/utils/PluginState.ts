import { DictionaryResource } from '@/typings'
import { VoiceType } from './../typings/index'
import { idDictionaryMap } from './../resource/dictionary'
import { compareWord, getConfig, getDictFile } from '.'
import * as vscode from 'vscode'
import { Word } from '@/typings'
import * as fs from 'fs'
import * as path from 'path'

export default class PluginState {
  private _globalState: vscode.Memento

  private _dictKey: string
  private dictWords: Word[]
  public dict: DictionaryResource
  public hideDictName: boolean

  public chapterLength: number
  private _readOnlyMode: boolean
  public readOnlyIntervalId: NodeJS.Timeout | null
  public placeholder: string

  public _wordVisibility: boolean
  private currentExerciseCount: number

  private _order: number
  private _chapter: number
  public isStart: boolean
  public hasWrong: boolean
  private curInput: string
  public chapterCycleMode: boolean

  public voiceLock: boolean
  public translationVisible: boolean

  private _wordList: {
    wordList: Word[]
    chapter: number
    dictKey: string
  }
  private outputChannel: vscode.OutputChannel

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('QWERTY Learner');
    this.outputChannel.show();
    const globalState = context.globalState
    this._globalState = globalState
    globalState.setKeysForSync(['chapter', 'dictKey'])

    this._dictKey = globalState.get('dictKey', 'cet4')
    this.dict = idDictionaryMap[this._dictKey]
    this.dictWords = []
    this.hideDictName = false
    this.loadDict()

    this._order = globalState.get('order', 0)
    this._chapter = globalState.get('chapter', 0)
    this.isStart = false
    this.hasWrong = false
    this.curInput = ''
    this.currentExerciseCount = 0

    this.chapterLength = getConfig('chapterLength')
    this._readOnlyMode = false
    this.readOnlyIntervalId = null
    this.placeholder = getConfig('placeholder') // 用于控制word不可见时，inputBar中是否出现占位符及样式
    this.chapterCycleMode = false

    this._wordVisibility = globalState.get('wordVisibility', true)

    this.voiceLock = false

    this.translationVisible = true
    this._wordList = {
      wordList: [],
      chapter: 0,
      dictKey: this._dictKey,
    }
  }

  get chapter(): number {
    return this._chapter
  }
  set chapter(value: number) {
    this._chapter = value
    this.order = 0
    this.currentExerciseCount = 0
    this._globalState.update('chapter', this._chapter)
    this._globalState.update('order', this.order)
  }

  get order(): number {
    return this._order
  }
  set order(value: number) {
    this._order = value
    this._globalState.update('order', this._order)
  }

  get dictKey(): string {
    return this._dictKey
  }
  set dictKey(value: string) {
    this.order = 0
    this.currentExerciseCount = 0
    this.chapter = 0
    this._dictKey = value
    this.dict = idDictionaryMap[this._dictKey]
    this._globalState.update('dictKey', this._dictKey)
    this.loadDict()
  }

  get wordExerciseTime(): number {
    return getConfig('wordExerciseTime')
  }
  get wordList(): Word[] {
    if (this._wordList.wordList.length > 0 && this._wordList.dictKey === this.dictKey && this._wordList.chapter === this.chapter) {
      return this._wordList.wordList
    } else {
      let wordList = this.dictWords.slice(this.chapter * this.chapterLength, (this.chapter + 1) * this.chapterLength)
      wordList.forEach((word) => {
        // API 字典会出现括号，但部分 vscode 插件会拦截括号的输入
        word.name = word.name.replace('(', '').replace(')', '')
      })

      const isRandom = getConfig('random')
      if (isRandom) {
        wordList = wordList.sort(() => Math.random() - 0.5)
      }

      this._wordList = {
        wordList,
        chapter: this.chapter,
        dictKey: this.dictKey,
      }

      return wordList
    }
  }

  get wordVisibility(): boolean {
    return this._wordVisibility
  }
  set wordVisibility(value: boolean) {
    this._wordVisibility = value
    this._globalState.update('wordVisibility', this._wordVisibility)
  }

  get totalChapters(): number {
    if (this.dictWords) {
      return Math.ceil(this.dictWords.length / this.chapterLength)
    } else {
      return 0
    }
  }

  get currentWord(): Word {
    return this.wordList[this.order]
  }
  get compareResult(): number {
    return compareWord(this.currentWord.name, this.curInput)
  }
  get highlightWrongColor(): string {
    return getConfig('highlightWrongColor')
  }
  get highlightWrongDelay(): number {
    return getConfig('highlightWrongDelay')
  }
  get readOnlyMode(): boolean {
    return this._readOnlyMode
  }
  set readOnlyMode(value: boolean) {
    this._readOnlyMode = value
    this._globalState.update('readOnlyMode', this._readOnlyMode)
  }
  get readOnlyInterval(): number {
    return getConfig('readOnlyInterval')
  }
  get voiceType(): VoiceType {
    return getConfig('voiceType')
  }
  get shouldPlayVoice(): boolean {
    return this.voiceType !== 'close' && !this.voiceLock
  }

  wrongInput() {
    this.hasWrong = true
    this.curInput = ''
  }

  clearWrong() {
    this.hasWrong = false
  }

  finishWord() {
    this.curInput = ''
    this.currentExerciseCount += 1
    if (this.currentExerciseCount >= this.wordExerciseTime) {
      this.nextWord()
    }
    this.voiceLock = false
  }

  prevWord() {
    if (this.order > 0) {
      this.order -= 1
      this.currentExerciseCount = 0
    }
  }

  nextWord() {
    if (this.order === this.wordList.length - 1) {
      //是否章节循环
      if (this.chapterCycleMode) {
      } else {
        // 结束本章节
        if (this.chapter === this.totalChapters - 1) {
          this.chapter = 0
        } else {
          this.chapter += 1
        }
      }

      this.order = 0
    } else {
      this.order += 1
    }
    this.currentExerciseCount = 0
    /*vscode.window.createOutputChannel('QWERTY Learner').appendLine(`next word called`)
    console.log(`next word called`)*/
  }
  saveWord() {
    //this.outputChannel.appendLine('saveWord called');
    this.prevWord();
    //this.outputChannel.appendLine('Current word to save: ' + this.currentWord.name);
    this.writeFile(this.currentWord.name);
    this.nextWord();
  }
  toggleDictName() {
    this.hideDictName = !this.hideDictName
  }

  toggleTranslation() {
    this.translationVisible = !this.translationVisible
  }
  getInitialWordBarContent() {
    const name = this.hideDictName ? '' : this.dict.name
    return `${name} chp.${this.chapter + 1}  ${this.order + 1}/${this.wordList.length}  ${this.wordVisibility ? this.currentWord.name : ''}`
  }

  getInitialInputBarContent() {
    let content = ''
    if (this.wordVisibility || this.placeholder === '') {
      content = ''
    } else {
      // 拼接占位符
      content = this.currentWord.name[0]+this.placeholder.repeat(this.currentWord.name.length-1)
    }
    return content
  }

  getInitialPlayVoiceBarContent() {
    let content = `/${this._getCurrentWordPhonetic()}/`
    content = content.replace(/\n/g, ' ')
    return content
  }
  getInitialTranslationBarContent() {
    const content = this.translationVisible ? '$(eye)' : this.currentWord.trans.join('; ')
    return content
  }

  getCurrentInputBarContent(input: string) {
    let content = ''
    if (this.wordVisibility || this.placeholder === '') {
      // 没有使用placeholder，不需要特殊处理
      this.curInput += input
      content = this.curInput
    } else {
      // 拼接占位符 && 获取当前已经键入的值进行比较
      this.curInput += input
      content = this.curInput + this.placeholder.repeat(this.currentWord.name.length - this.curInput.length)
    }
    return content
  }

  private _getCurrentWordPhonetic() {
    let phonetic = ''
    switch (getConfig('phonetic')) {
      case 'us':
        phonetic = this.currentWord.usphone || ''
        break
      case 'uk':
        phonetic = this.currentWord.ukphone || ''
        break
      case 'close':
        phonetic = ''
        break
    }
    return phonetic
  }

  private loadDict() {
    this.dictWords = getDictFile(this.dict.url)
  }

  getFilePath(): string {
    // 把文件存到用户的 VSCode 扩展数据目录（插件 ID 需替换）
    const storagePath = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath // 工作区根目录
        : path.join(__dirname, '..'); // 备选目录

    const filePath = path.join(storagePath, 'words.txt');
    //console.log('File path:', filePath);
    return filePath;
  }

  writeFile(word: string) {
    const filePath = this.getFilePath();
    //console.log('Attempting to write to file:', filePath);
    fs.appendFile(filePath, word + '\n', (err) => {
        if (err) {
            console.error('Error writing to file:', err);
            //vscode.window.showErrorMessage('保存生词失败: ' + err.message);
        } else {
            console.log('Successfully wrote to file');
            //vscode.window.showInformationMessage(`已保存: ${word}`);
        }
    });
  }
}
