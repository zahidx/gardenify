'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sprout,
  CalendarDays,
  CheckCircle,
  Leaf,
  Droplets,
  Sun,
  History,
  Flower,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';

// Firebase Imports
import { db } from '../lib/firebase'; // Adjust path if needed
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  writeBatch,
  query,
  orderBy,
  serverTimestamp,
  FieldValue, // <-- FIX: Import FieldValue
} from 'firebase/firestore';

// Type definitions
type Task = {
  label: string;
  dayLabel: string;
  icon: React.ElementType;
  applyIntervalDays?: number;
};

type ApplicationEvent = {
  id?: string; // Add ID for keying
  label: string;
  dayLabel: string;
  timestampIso: string;
};

// Firestore collection references
const applicationsCollection = collection(db, 'applications');
const lastDatesDoc = doc(db, 'metadata', 'lastApplicationDates');

export default function Home() {
  const staticTasks = useMemo<Task[]>(
    () => [
      { label: 'Pest Control - Ch🧪', dayLabel: 'Day 1', icon: Droplets, applyIntervalDays: 7 },
      { label: 'Pest Control - Neem 🌿', dayLabel: 'Day 7', icon: Leaf, applyIntervalDays: 7 },
      { label: 'Fungicide - Amistar Top 🍄', dayLabel: 'Day 15', icon: Flower, applyIntervalDays: 30 },
      { label: 'Chemical Fertilizer 🔬', dayLabel: 'Day 18', icon: Sprout, applyIntervalDays: 30 },
      { label: 'Fungicide - Masnsar 🧪', dayLabel: 'Day 20', icon: Flower, applyIntervalDays: 30 },
      { label: 'Mustard Fertilizer 🌱', dayLabel: 'Day 22', icon: Sprout, applyIntervalDays: 15 },
      { label: 'Cow Dung & Vermicompost 🐮', dayLabel: 'Day 26', icon: Sprout },
      { label: 'PGR Application 🪴', dayLabel: 'Day 30', icon: Sun, applyIntervalDays: 30 },
    ],
    []
  );
  const [tasks] = useState<Task[]>(staticTasks);

  // State is now initialized as empty, will be populated from Firebase
  const [applications, setApplications] = useState<ApplicationEvent[]>([]);
  const [lastApplicationDates, setLastApplicationDates] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true); // Loading state for initial fetch

  // State for triggering daily re-render for countdowns
  const [currentDate, setCurrentDate] = useState(new Date());

  // --- Data Fetching from Firebase ---
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch all applications, ordered by timestamp descending
        const q = query(applicationsCollection, orderBy('timestamp', 'desc'));
        const appSnapshot = await getDocs(q);
        const appData = appSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as ApplicationEvent)
        );
        setApplications(appData);

        // Fetch the single document for last application dates
        const datesSnapshot = await getDoc(lastDatesDoc);
        if (datesSnapshot.exists()) {
          setLastApplicationDates(datesSnapshot.data());
        }
      } catch (error) {
        console.error('Error fetching data from Firebase:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Effect to update current date daily for countdown refresh
  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000 * 60 * 60 * 24);
    return () => clearInterval(timer);
  }, []);

  // --- Derive `appliedTimestamps` from the `applications` state ---
  const appliedTimestamps = useMemo(() => {
    const newTimestamps: string[][] = staticTasks.map(() => []);
    const formatMonthDay = (date: Date) =>
      `${
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
          date.getMonth()
        ]
      } ${date.getDate()}`;
    const formatHourMinute = (date: Date) =>
      `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

    applications.forEach((appEvent) => {
      const taskIndex = staticTasks.findIndex((task) => task.label === appEvent.label);
      if (taskIndex !== -1) {
        const date = new Date(appEvent.timestampIso);
        const friendlyFormat = `${formatMonthDay(date)} – ${formatHourMinute(date)}`;
        newTimestamps[taskIndex].push(friendlyFormat);
      }
    });
    return newTimestamps;
  }, [applications, staticTasks]);

  // --- CRUD Functions for Firebase ---

  const handleApply = async (index: number) => {
    const task = tasks[index];
    const now = new Date();
    const iso = now.toISOString();

    const newApplication: Omit<ApplicationEvent, 'id'> & { timestamp: FieldValue } = { // <-- FIX: Use FieldValue
      label: task.label,
      dayLabel: task.dayLabel,
      timestampIso: iso,
      timestamp: serverTimestamp(),
    };

    try {
      // 1. Add new application to the 'applications' collection
      const docRef = await addDoc(applicationsCollection, newApplication);

      // Optimistically update UI
      setApplications((prev) => [{ id: docRef.id, ...newApplication, timestampIso: iso }, ...prev]);

      // 2. Update the last application date if interval exists
      if (task.applyIntervalDays !== undefined) {
        const newLastDate = { [task.label]: iso };
        await setDoc(lastDatesDoc, newLastDate, { merge: true });

        // Optimistically update UI
        setLastApplicationDates((prev) => ({ ...prev, ...newLastDate }));
      }
    } catch (error) {
      console.error('Error applying task:', error);
    }
  };

  const handleReset = useCallback(async () => {
    if (!confirm('Are you sure you want to reset all data? This cannot be undone.')) {
      return;
    }

    try {
      // Use a batch write for atomic deletion
      const batch = writeBatch(db);

      // Delete all documents in the 'applications' collection
      const appSnapshot = await getDocs(applicationsCollection);
      appSnapshot.forEach((doc) => batch.delete(doc.ref));

      // Delete the 'lastApplicationDates' document
      batch.delete(lastDatesDoc);

      await batch.commit();

      // Clear local state
      setApplications([]);
      setLastApplicationDates({});
      console.log('All data reset successfully.');
    } catch (error) {
      console.error('Error resetting data:', error);
    }
  }, []);

  const calculateCountdown = useCallback(
    (taskLabel: string, intervalDays: number | undefined) => {
      if (intervalDays === undefined) return null;
      const lastAppliedIso = lastApplicationDates[taskLabel];
      if (!lastAppliedIso) return null;

      const lastAppliedDate = new Date(lastAppliedIso);
      const nextApplicationDate = new Date(lastAppliedDate);
      nextApplicationDate.setDate(lastAppliedDate.getDate() + intervalDays);
      nextApplicationDate.setHours(0, 0, 0, 0);

      const today = new Date(currentDate); // Use a copy to avoid mutation
      today.setHours(0, 0, 0, 0);

      const diffTime = nextApplicationDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        return { text: 'Deadline Over', status: 'overdue' };
      } else {
        return { text: `Next Apply in ${diffDays} days`, status: 'countdown' };
      }
    },
    [lastApplicationDates, currentDate]
  );

  const totalApplied = applications.length;

  // Typed variants
  const sectionVariants: Variants = {
    initial: { opacity: 0, y: 50 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 100, damping: 10, delay: 0.3 },
    },
    hover: {
      scale: 1.01,
      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3), 0 10px 10px -5px rgba(0,0,0,0.15)',
    },
  };

  const cardVariants: Variants = {
    initial: { opacity: 0, y: 20 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 100, damping: 10 },
    },
    hover: {
      scale: 1.02,
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2), 0 4px 6px -2px rgba(0,0,0,0.08)',
    },
  };

  const buttonVariants: Variants = {
    hover: {
      y: -2,
      scale: 1.02,
      background: 'linear-gradient(to right, var(--tw-gradient-stops) 100%)',
      boxShadow: '0 5px 15px rgba(0,200,0,0.3)',
    },
    tap: { scale: 0.95 },
  };

  const resetButtonVariants: Variants = {
    hover: { y: -1, scale: 1.05, boxShadow: '0 5px 15px rgba(255,0,0,0.3)' },
    tap: { scale: 0.9 },
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <Sprout className="w-16 h-16 text-lime-400 animate-bounce" />
          <p className="text-xl text-gray-300 mt-4">Loading your garden...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-zinc-950 py-6 sm:py-10 px-4 sm:px-6 lg:px-8 text-gray-100 overflow-hidden">
      <div className="max-w-6xl mx-auto space-y-8 sm:space-y-12">
        {/* Header */}
        <header className="text-center relative pt-4">
          <motion.h1
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 10, delay: 0.1 }}
            className="text-4xl sm:text-5xl font-extrabold text-emerald-400 flex items-center justify-center gap-3 drop-shadow-lg"
          >
            <Sprout className="w-8 h-8 sm:w-10 sm:h-10 text-lime-400" />
            Gardenify
          </motion.h1>
          <motion.p
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 10, delay: 0.3 }}
            className="text-md sm:text-xl text-gray-400 mt-2 sm:mt-3 italic"
          >
            Your personal garden care assistant 🌼
          </motion.p>

          <motion.button
            onClick={handleReset}
            variants={resetButtonVariants}
            whileHover="hover"
            whileTap="tap"
            className="block mx-auto mt-4 sm:absolute sm:top-0 sm:right-0 sm:mt-4 sm:mr-4 flex items-center gap-2 px-3 py-1 sm:px-4 sm:py-2 rounded-full bg-red-700 text-white text-sm font-semibold shadow-lg transition-all duration-300 z-10"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All
          </motion.button>
        </header>

        {/* Treatment Schedule */}
        <motion.section
          variants={sectionVariants}
          initial="initial"
          animate="animate"
          whileHover="hover"
          className="glass-effect rounded-2xl sm:rounded-3xl shadow-2xl border border-zinc-700 p-6 sm:p-8 relative overflow-hidden"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-emerald-400 mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
            <CalendarDays className="w-7 h-7 sm:w-8 sm:h-8 text-lime-400" />
            Treatment Schedule <span className="text-xl sm:text-2xl ml-1 sm:ml-2">🗓️</span>
          </h2>
          <p className="text-base sm:text-lg text-gray-300 mb-5 sm:mb-6 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" /> Total applied actions:{' '}
            <span className="font-semibold text-emerald-300">{totalApplied}</span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {tasks.map((task, idx) => {
              const TaskIcon = task.icon;
              const countdown = calculateCountdown(task.label, task.applyIntervalDays);
              const appliedCountForTask = appliedTimestamps[idx].length;

              return (
                <motion.div
                  key={idx}
                  variants={cardVariants}
                  initial="initial"
                  animate="animate"
                  whileHover="hover"
                  transition={{ delay: idx * 0.1 }}
                  className="flex flex-col bg-zinc-900/50 p-5 sm:p-6 rounded-xl sm:rounded-2xl border border-zinc-700 shadow-xl"
                >
                  <div className="flex justify-between items-start mb-3 sm:mb-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <TaskIcon className="w-6 h-6 sm:w-7 sm:h-7 text-lime-400" />
                      <div className="flex flex-col">
                        <span className="text-lg sm:text-xl text-gray-100 font-bold">
                          {task.label}
                        </span>
                        <span className="mt-0.5 sm:mt-1 text-sm sm:text-md text-gray-400">
                          {task.dayLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  {appliedCountForTask > 0 && (
                    <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-zinc-700">
                      <h4 className="text-xs sm:text-sm font-medium text-gray-300 mb-1 sm:mb-2">
                        Recent Applications:
                      </h4>
                      <ul className="space-y-1">
                        {appliedTimestamps[idx].slice(0, 3).map((tsStr, i) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 100,
                              damping: 10,
                              delay: i * 0.03,
                            }}
                            className="flex items-center gap-2 text-xs sm:text-sm text-sky-300 bg-sky-900/50 px-2 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg border border-sky-800"
                          >
                            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-sky-400 rounded-full flex-shrink-0" />
                            <span>Applied: {tsStr}</span>
                          </motion.li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {countdown && (
                    <motion.div
                      key={`countdown-${idx}-${countdown.text}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 100, damping: 10, delay: 0.1 }}
                      className={`mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-zinc-700 text-center text-sm sm:text-base font-semibold ${
                        countdown.status === 'overdue' ? 'text-red-400' : 'text-amber-300'
                      }`}
                    >
                      {countdown.text}
                    </motion.div>
                  )}
                  <div className="mt-auto flex flex-col sm:flex-row items-center justify-between pt-3 sm:pt-4 gap-3 sm:gap-0">
                    <motion.button
                      onClick={() => handleApply(idx)}
                      variants={buttonVariants}
                      whileTap="tap"
                      whileHover="hover"
                      className="flex items-center justify-center gap-2 px-4 py-2 sm:px-6 sm:py-3 rounded-full bg-gradient-to-r from-emerald-600 to-green-700 text-white font-semibold shadow-lg transition-all duration-300 w-full sm:w-auto"
                    >
                      <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                      Apply Now
                    </motion.button>
                    <AnimatePresence>
                      {appliedCountForTask > 0 && (
                        <motion.span
                          key={appliedCountForTask}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.2 }}
                          className="bg-yellow-900/50 text-yellow-300 text-xs sm:text-sm px-2 py-0.5 sm:px-3 sm:py-1 rounded-full font-medium shadow-sm border border-yellow-800"
                        >
                          Applied {appliedCountForTask} times
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* Recent Activity */}
        <motion.section
          variants={sectionVariants}
          initial="initial"
          animate="animate"
          whileHover="hover"
          className="glass-effect rounded-2xl sm:rounded-3xl shadow-2xl border border-zinc-700 p-6 sm:p-8 relative overflow-hidden"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-emerald-400 mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
            <History className="w-7 h-7 sm:w-8 sm:h-8 text-lime-400" />
            Recent Activity <span className="text-xl sm:text-2xl ml-1 sm:ml-2">⏳</span>
          </h2>
          <ul className="space-y-2 sm:space-y-3 text-gray-300 text-sm sm:text-base max-h-64 sm:max-h-72 overflow-y-auto pr-2 custom-scrollbar">
            <AnimatePresence>
              {applications.length > 0 ? (
                applications.map((event, i) => (
                  <motion.li
                    key={event.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 100, damping: 10, delay: i * 0.03 }}
                    className="flex items-center gap-2 sm:gap-3 bg-zinc-900/50 p-2 sm:p-3 rounded-md sm:rounded-lg border border-zinc-700 shadow-md"
                  >
                    <span className="text-xl sm:text-2xl flex-shrink-0">✨</span>
                    <div>
                      <span>
                        Applied <strong className="text-emerald-300">&ldquo;{event.label}&rdquo;</strong> (Day{' '}
                        <span className="font-semibold">{event.dayLabel.split(' ')[1]}</span>)
                      </span>
                      <div className="text-xs sm:text-sm text-gray-400 mt-0.5">
                        on {new Date(event.timestampIso).toLocaleString()}
                      </div>
                    </div>
                  </motion.li>
                ))
              ) : (
                <motion.li
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-gray-500 text-base sm:text-lg py-4 text-center"
                >
                  No applied actions yet. Let&rsquo;s get gardening! 🌱
                </motion.li>
              )}
            </AnimatePresence>
          </ul>
        </motion.section>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #52525b;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #71717a;
        }

        .glass-effect {
          background-color: rgba(39, 39, 42, 0.4);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(113, 113, 122, 0.3);
        }
      `}</style>
    </main>
  );
}