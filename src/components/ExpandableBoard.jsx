import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';
import ReactECharts from 'echarts-for-react';

const { FiExpand, FiMinimize, FiX } = FiIcons;

function ExpandableBoard({ entries, activityType, isExpanded, onToggle }) {
  const getWordCloudData = () => {
    const wordCount = {};
    entries.forEach(entry => {
      const word = entry.content.toLowerCase().trim();
      if (word) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });
    return Object.entries(wordCount).map(([name, value]) => ({
      name,
      value: Math.max(12, Math.sqrt(value) * 30),
      textStyle: {
        color: `hsl(${Math.random() * 360}, 70%, 50%)`
      }
    }));
  };

  const wordCloudOption = {
    backgroundColor: 'transparent',
    series: [{
      type: 'wordCloud',
      gridSize: 8,
      sizeRange: [16, 80],
      rotationRange: [-90, 90],
      rotationStep: 45,
      shape: 'circle',
      width: '100%',
      height: '100%',
      drawOutOfBound: false,
      textStyle: {
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
      },
      emphasis: {
        focus: 'self',
        textStyle: {
          shadowBlur: 10,
          shadowColor: '#333'
        }
      },
      data: getWordCloudData()
    }],
    animation: true,
    animationDuration: 1000,
    animationEasing: 'elasticOut'
  };

  const renderContent = () => {
    if (entries.length === 0) {
      return (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">⏳</div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            Waiting for responses...
          </h3>
          <p className="text-gray-500">
            Students will see their submissions appear here in real-time
          </p>
        </div>
      );
    }

    if (activityType === 'wordcloud') {
      return (
        <div className={`${isExpanded ? 'h-[80vh]' : 'h-96'} w-full`}>
          <ReactECharts
            option={wordCloudOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true} // Ensure full redraw on data change
          />
        </div>
      );
    }

    // Always ensure entries are sorted by timestamp (newest first)
    const sortedEntries = [...entries].sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return (
      <div className={`${isExpanded ? 'h-[80vh]' : 'max-h-96'} overflow-y-auto`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedEntries.map((entry, index) => (
            <motion.div
              key={`${entry.id || entry.timestamp}-${index}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 p-4 rounded-lg hover:shadow-md transition-all duration-200"
            >
              <div className="font-semibold text-purple-600 text-sm mb-2">
                {entry.student_name}
              </div>
              <p className="text-gray-800 leading-relaxed">{entry.content}</p>
              <div className="text-xs text-gray-500 mt-2">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  if (isExpanded) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-800">
                Student Responses ({entries.length})
              </h2>
              <button
                onClick={onToggle}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <SafeIcon icon={FiX} className="text-2xl text-gray-600" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-hidden">
              {renderContent()}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Student Responses ({entries.length})</h3>
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm"
        >
          <SafeIcon icon={FiExpand} />
          Expand
        </button>
      </div>
      {renderContent()}
    </div>
  );
}

export default ExpandableBoard;