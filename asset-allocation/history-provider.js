(function(root){
  const facade={getMonthlySnapshots:()=>root.AllocationData.get().getMonthlySnapshots(),getAvailableDateRange:()=>root.AllocationData.get().getAvailableDateRange()};
  root.AllocationHistory={get:()=>facade};
})(globalThis);
