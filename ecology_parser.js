const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');

class EcologyParser {
    constructor() {
        this.chapters = [];
        this.questionTypes = [
            '名词解释',
            '填空题', 
            '选择题',
            '判断题',
            '简答题',
            '论述题',
            '计算题'
        ];
        
        // Fuse.js 配置用于模糊搜索
        this.fuseOptions = {
            includeScore: true,
            threshold: 0.3,
            keys: ['text']
        };
    }

    // 读取并解析文件
    parseFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.extractChapters(content);
            this.processChapters();
            return this.chapters;
        } catch (error) {
            console.error('读取文件失败:', error);
            return [];
        }
    }

    // 提取章节信息
    extractChapters(content) {
        // 跳过目录部分，从"第一篇"开始查找章节
        const firstPartIndex = content.indexOf('# 第一篇 基础生态学');
        const contentFromFirstPart = firstPartIndex !== -1 ? content.substring(firstPartIndex) : content;

        const chapterRegex = /^# 第([一二三四五六七八九十]+)章\s*(.+?)$/gm;

        let match;
        while ((match = chapterRegex.exec(contentFromFirstPart)) !== null) {
            const chapterNumber = this.chineseToNumber(match[1]);
            const chapterTitle = match[2].trim();

            console.log(`发现章节: 第${chapterNumber}章 ${chapterTitle}`);

            this.chapters.push({
                number: chapterNumber,
                title: chapterTitle,
                fullTitle: `第${chapterNumber}章 ${chapterTitle}`,
                content: '',
                realExamAnalysis: '',
                questionCollection: '',
                referenceAnswers: '',
                questionTypeContents: {}
            });
        }
    }

    // 中文数字转阿拉伯数字
    chineseToNumber(chinese) {
        const map = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
            '十一': 11
        };
        return map[chinese] || chinese;
    }

    // 阿拉伯数字转中文数字
    numberToChinese(number) {
        const map = {
            1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
            6: '六', 7: '七', 8: '八', 9: '九', 10: '十',
            11: '十一'
        };
        return map[number] || number.toString();
    }

    // 处理章节内容
    processChapters() {
        const content = fs.readFileSync('生态学考研精解.md', 'utf-8');
        
        for (let i = 0; i < this.chapters.length; i++) {
            const chapter = this.chapters[i];
            const nextChapter = this.chapters[i + 1];
            
            // 提取当前章节的完整内容
            const chapterContent = this.extractChapterContent(content, chapter, nextChapter);
            chapter.content = chapterContent;
            
            // 提取试题荟萃和参考答案部分
            this.extractMainSections(chapter);
            
            // 按题型拆分内容
            this.extractQuestionTypeContents(chapter);
        }
    }

    // 提取章节内容
    extractChapterContent(content, chapter, nextChapter) {
        // 使用中文数字匹配章节标题
        const chineseNumber = this.numberToChinese(chapter.number);
        const startPattern = new RegExp(`^# 第${chineseNumber}章\\s*${chapter.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
        const startMatch = content.match(startPattern);

        if (!startMatch) {
            console.warn(`未找到章节开始: 第${chineseNumber}章 ${chapter.title}`);
            return '';
        }

        const startIndex = startMatch.index;
        let endIndex = content.length;

        if (nextChapter) {
            const nextChineseNumber = this.numberToChinese(nextChapter.number);
            const endPattern = new RegExp(`^# 第${nextChineseNumber}章\\s*${nextChapter.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
            const endMatch = content.match(endPattern);
            if (endMatch) {
                endIndex = endMatch.index;
            }
        }

        return content.substring(startIndex, endIndex);
    }

    // 提取试题荟萃和参考答案部分
    extractMainSections(chapter) {
        const content = chapter.content;

        // 提取真题解析部分
        const realExamMatch = content.match(/【真题解析】([\s\S]*?)【试题荟萃】/);
        if (realExamMatch) {
            chapter.realExamAnalysis = realExamMatch[1].trim();
        }

        // 提取试题荟萃部分
        const questionCollectionMatch = content.match(/【试题荟萃】([\s\S]*?)【参考答案】/);
        if (questionCollectionMatch) {
            chapter.questionCollection = questionCollectionMatch[1].trim();
        }

        // 提取参考答案部分
        const referenceAnswersMatch = content.match(/【参考答案】([\s\S]*?)(?=# 第|$)/);
        if (referenceAnswersMatch) {
            chapter.referenceAnswers = referenceAnswersMatch[1].trim();
        }
    }

    // 按题型拆分内容
    extractQuestionTypeContents(chapter) {
        if (!chapter.questionCollection || !chapter.referenceAnswers) {
            return;
        }

        for (const questionType of this.questionTypes) {
            // 在试题荟萃中查找该题型
            const questionContent = this.extractQuestionTypeFromSection(chapter.questionCollection, questionType);
            
            // 在参考答案中查找该题型
            const answerContent = this.extractQuestionTypeFromSection(chapter.referenceAnswers, questionType);
            
            // 如果找到了题型内容，保存起来
            if (questionContent || answerContent) {
                chapter.questionTypeContents[questionType] = {
                    questions: questionContent || '',
                    answers: answerContent || ''
                };
                
                console.log(`  找到题型: ${questionType}`);
            }
        }
    }

    // 从某个部分中提取特定题型的内容
    extractQuestionTypeFromSection(sectionContent, questionType) {
        // 首先尝试精确匹配
        const exactPattern = new RegExp(`^#\\s*[一二三四五六七八九十]+、\\s*${questionType}\\s*$`, 'm');
        let match = sectionContent.match(exactPattern);
        
        // 如果精确匹配失败，使用模糊搜索
        if (!match) {
            const lines = sectionContent.split('\n');
            const searchData = lines.map((line, index) => ({ text: line, index }));
            const fuse = new Fuse(searchData, this.fuseOptions);
            
            const results = fuse.search(questionType);
            if (results.length > 0) {
                const lineIndex = results[0].item.index;
                const line = lines[lineIndex];
                if (line.includes(questionType)) {
                    match = [line];
                }
            }
        }
        
        if (!match) {
            return null;
        }
        
        const startIndex = sectionContent.indexOf(match[0]);
        let endIndex = sectionContent.length;
        
        // 找到下一个题型的开始位置
        const nextTypePattern = /^#\s*[一二三四五六七八九十]+、\s*[^#\n]+/gm;
        nextTypePattern.lastIndex = startIndex + match[0].length;
        const nextMatch = nextTypePattern.exec(sectionContent);
        if (nextMatch) {
            endIndex = nextMatch.index;
        }
        
        return sectionContent.substring(startIndex, endIndex).trim();
    }

    // 生成输出文件
    generateOutputFiles(outputDir = './output') {
        // 创建输出目录
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const generatedFiles = [];

        for (const chapter of this.chapters) {
            // 生成真题解析文件
            if (chapter.realExamAnalysis && chapter.realExamAnalysis.trim()) {
                const fileName = `第${chapter.number}章+真题解析+试题与答案+真题解析.yaml`;
                const filePath = path.join(outputDir, fileName);

                const yamlContent = this.generateRealExamYaml(chapter);

                try {
                    fs.writeFileSync(filePath, yamlContent, 'utf-8');
                    generatedFiles.push(fileName);
                    console.log(`生成文件: ${fileName}`);
                } catch (error) {
                    console.error(`生成文件失败 ${fileName}:`, error);
                }
            }

            // 生成各题型文件
            for (const [questionType, content] of Object.entries(chapter.questionTypeContents)) {
                if (content.questions || content.answers) {
                    const fileName = `第${chapter.number}章+真题解析+试题与答案+${questionType}.yaml`;
                    const filePath = path.join(outputDir, fileName);

                    const yamlContent = this.generateYamlContent(chapter, questionType, content);

                    try {
                        fs.writeFileSync(filePath, yamlContent, 'utf-8');
                        generatedFiles.push(fileName);
                        console.log(`生成文件: ${fileName}`);
                    } catch (error) {
                        console.error(`生成文件失败 ${fileName}:`, error);
                    }
                }
            }
        }

        return generatedFiles;
    }

    // 生成真题解析 YAML 内容
    generateRealExamYaml(chapter) {
        // 确定所属大模块
        let majorModule;
        if (chapter.number <= 5) {
            majorModule = '基础生态学';
        } else {
            majorModule = '应用生态学';
        }

        const yaml = `---
# 元数据
单元: 第${chapter.number}章 ${chapter.title}
所属大模块: ${majorModule}
题目种类: 真题解析
生成时间: ${new Date().toISOString()}

# 主内容
真题解析: |
${this.indentContent(chapter.realExamAnalysis, 2)}
---`;

        return yaml;
    }

    // 生成 YAML 内容
    generateYamlContent(chapter, questionType, content) {
        // 确定所属大模块
        let majorModule;
        if (chapter.number <= 5) {
            majorModule = '基础生态学';
        } else {
            majorModule = '应用生态学';
        }

        const yaml = `---
# 元数据
单元: 第${chapter.number}章 ${chapter.title}
所属大模块: ${majorModule}
题目种类: ${questionType}
生成时间: ${new Date().toISOString()}

# 主内容
试题荟萃: |
${this.indentContent(content.questions, 2)}

参考答案: |
${this.indentContent(content.answers, 2)}
---`;

        return yaml;
    }

    // 缩进内容
    indentContent(content, spaces) {
        if (!content) return '';
        const indent = ' '.repeat(spaces);
        return content.split('\n').map(line => indent + line).join('\n');
    }
}

// 主函数
function main() {
    console.log('开始解析生态学考研精解文件...\n');
    
    const parser = new EcologyParser();
    
    // 解析文件
    const chapters = parser.parseFile('生态学考研精解.md');
    
    if (chapters.length === 0) {
        console.error('未能解析到任何章节内容');
        return;
    }
    
    // 生成输出文件
    const generatedFiles = parser.generateOutputFiles();
    
    console.log(`\n拆解完成！共生成 ${generatedFiles.length} 个文件`);
    console.log('输出目录: ./output');
}

// 导出模块
module.exports = EcologyParser;

// 如果直接运行此文件
if (require.main === module) {
    main();
}
