import { useParams, useNavigate } from "react-router-dom";
import { providers, getAvailableSlots } from "@/lib/mock-data";
import type { Service } from "@/lib/mock-data";
import { ArrowLeft, Check, Clock, CalendarDays } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, addDays } from "date-fns";

const BookAppointment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const provider = providers.find((p) => p.id === id);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");

  if (!provider) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Provider not found</p>
      </div>
    );
  }

  const toggleService = (service: Service) => {
    setSelectedServices((prev) =>
      prev.find((s) => s.id === service.id)
        ? prev.filter((s) => s.id !== service.id)
        : [...prev, service]
    );
  };

  const total = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
  const availableSlots = getAvailableSlots(provider.id, selectedDate);

  // Generate next 14 days
  const dates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

  const canProceed =
    (step === 1 && selectedServices.length > 0) ||
    (step === 2 && selectedTime) ||
    step === 3;

  const handleNext = () => {
    if (step === 1 && selectedServices.length > 0) setStep(2);
    else if (step === 2 && selectedTime) setStep(3);
  };

  const handleConfirm = () => {
    navigate("/booking-confirmed", {
      state: {
        provider: provider.name,
        services: selectedServices.map((s) => s.name),
        date: format(selectedDate, "EEE, MMM d"),
        time: selectedTime,
        total,
      },
    });
  };

  return (
    <div className="min-h-screen pb-28">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-10 pb-4">
        <button
          onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : navigate(-1))}
          className="p-2 -ml-2 rounded-full active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Book at {provider.name}</h1>
          <p className="text-xs text-muted-foreground">
            Step {step} of 3 —{" "}
            {step === 1 ? "Select services" : step === 2 ? "Pick a time" : "Confirm"}
          </p>
        </div>
      </header>

      {/* Progress */}
      <div className="flex gap-1.5 px-5 mb-6">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              s <= step ? "bg-accent" : "bg-border"
            )}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Services */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="px-5"
          >
            <div className="flex flex-col gap-2">
              {provider.services.map((service) => {
                const isSelected = selectedServices.find((s) => s.id === service.id);
                return (
                  <button
                    key={service.id}
                    onClick={() => toggleService(service)}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]",
                      isSelected
                        ? "border-accent bg-accent/5"
                        : "border-border bg-card"
                    )}
                  >
                    <div className="text-left">
                      <p className="text-sm font-medium">{service.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {service.duration} min
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold">${service.price}</span>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                          <Check className="h-3 w-3 text-accent-foreground" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Step 2: Date & Time */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="px-5"
          >
            {/* Date picker */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-accent" />
                Select date
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
                {dates.map((date) => {
                  const isSelected =
                    format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
                  return (
                    <button
                      key={date.toISOString()}
                      onClick={() => {
                        setSelectedDate(date);
                        setSelectedTime("");
                      }}
                      className={cn(
                        "flex flex-col items-center min-w-[56px] py-2.5 px-3 rounded-xl transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "bg-secondary text-foreground"
                      )}
                    >
                      <span className="text-[10px] font-medium uppercase">
                        {format(date, "EEE")}
                      </span>
                      <span className="text-lg font-bold">{format(date, "d")}</span>
                      <span className="text-[10px]">{format(date, "MMM")}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time slots */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-accent" />
                Available times
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => setSelectedTime(slot)}
                    className={cn(
                      "py-2.5 rounded-xl text-xs font-medium transition-colors active:scale-95",
                      selectedTime === slot
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary text-foreground hover:bg-secondary/80"
                    )}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="px-5"
          >
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Provider</p>
                <p className="font-semibold">{provider.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Date & Time</p>
                <p className="font-semibold">
                  {format(selectedDate, "EEE, MMM d")} at {selectedTime}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Services</p>
                {selectedServices.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm py-1">
                    <span>
                      {s.name}{" "}
                      <span className="text-muted-foreground">({s.duration} min)</span>
                    </span>
                    <span className="font-medium">${s.price}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 flex justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total ({totalDuration} min)</p>
                </div>
                <p className="text-lg font-bold">${total}</p>
              </div>
            </div>

            {/* Payment option */}
            <div className="mt-4 p-4 rounded-xl bg-secondary/60 text-sm text-muted-foreground">
              💳 Payment will be collected at the venue
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-xl border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {selectedServices.length} service{selectedServices.length !== 1 ? "s" : ""}
            </p>
            <p className="text-lg font-bold">${total}</p>
          </div>
          {step < 3 ? (
            <button
              disabled={!canProceed}
              onClick={handleNext}
              className={cn(
                "px-8 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97]",
                canProceed
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              className="px-8 py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.97] transition-transform"
            >
              Confirm Booking
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookAppointment;
